import { t } from "i18next";
import { z } from "zod";

import { BLACKLIST_URL, ITEMS_PER_REQUEST, SNIPPETS_URL } from "../constants";
import type { CardItem, RepoTopic, Snippet } from "../types/marketplace-types";
import { fetchGitHubJson, fetchJsonResource } from "./GitHubApi";
import { CACHE_TTL, readCache, writeCache } from "./RequestCache";
import { marketplaceStorage } from "./Storage";
import { isBlacklisted, processAuthors } from "./Utils";

const manifestSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    main: z.string().trim().min(1).optional(),
    usercss: z.string().trim().min(1).optional(),
    authors: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            url: z.url().optional()
          })
          .transform(({ name, url }) => ({ name, url: url || `https://github.com/${name}` }))
      )
      .catch([]),
    preview: z
      .string()
      .nullish()
      .transform((preview) => preview || ""),
    readme: z
      .string()
      .nullish()
      .transform((readme) => readme || ""),
    tags: z.union([z.array(z.string()), z.string().transform((tag) => [tag])]).catch([]),
    branch: z.string().trim().min(1).optional(),
    schemes: z.string().optional(),
    include: z.array(z.string()).catch([])
  })
  .passthrough();

const snippetSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z
      .string()
      .nullish()
      .transform((description) => description || ""),
    code: z.string(),
    preview: z
      .string()
      .nullish()
      .transform((preview) => preview || "")
  })
  .passthrough();

type ParsedManifest = z.infer<typeof manifestSchema>;

type SearchResponse = {
  items?: unknown[];
  total_count?: number;
};

type SearchRepo = {
  html_url: string;
  contents_url: string;
  default_branch: string;
  stargazers_count: number;
  archived: boolean;
  pushed_at: string;
  created_at: string;
};

const isSearchRepo = (item: unknown): item is SearchRepo => {
  if (!item || typeof item !== "object") return false;
  const repo = item as Partial<SearchRepo>;
  return typeof repo.html_url === "string" && typeof repo.contents_url === "string";
};

// TODO: add sort type, order, etc?
// https://docs.github.com/en/github/searching-for-information-on-github/searching-on-github/searching-for-repositories#search-by-topic
// https://docs.github.com/en/rest/reference/search#search-repositories

/**
 * Query GitHub for all repos with the requested topic
 * @param tag The tag ("topic") to search for
 * @param page The query page number
 * @returns Array of search results (filtered through the blacklist)
 */
export async function getTaggedRepos(tag: RepoTopic, page = 1, BLACKLIST: string[] = [], showArchived = false) {
  // www is needed or it will block with "cross-origin" error.
  let url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${tag}`)}&per_page=${ITEMS_PER_REQUEST}`;

  // We can test multiple pages with this URL (58 results), as well as broken iamges etc.
  // let url = `https://api.github.com/search/repositories?q=${encodeURIComponent("topic:spicetify")}`;
  if (page) url += `&page=${page}`;
  // Sorting params (not implemented for Marketplace yet)
  // if (sortConfig.by.match(/top|controversial/) && sortConfig.time) {
  //     url += `&t=${sortConfig.time}`

  const { data, rateLimited } = await fetchGitHubJson<SearchResponse>(url, {
    // Page 0 and page 1 hit the same endpoint, so they must share a cache entry
    cacheKey: `${tag}-page-${page || 1}`,
    ttlMs: CACHE_TTL.searchPage
  });

  if (!data || !Array.isArray(data.items)) {
    // The rate limit notification is raised by the fetcher, so don't double up on it
    if (!rateLimited) Spicetify.showNotification(t("notifications.tooManyRequests"), true, 5000);
    return { items: [] as SearchRepo[], total_count: 0, page_count: 0 };
  }

  const repos = data.items.filter(isSearchRepo);

  return {
    total_count: typeof data.total_count === "number" ? data.total_count : repos.length,
    // Include count of all items on the page, since we're filtering the blacklist below,
    // which can mess up the paging logic
    page_count: repos.length,
    items: repos.filter((item) => !isBlacklisted(item.html_url, BLACKLIST) && (showArchived || !item.archived))
  };
}

// Workaround for not spamming console with 404s
const script = `
  self.addEventListener('message', async (event) => {
    const url = event.data;
    const response = await fetch(url);
    const data = await response.json().catch(() => null);
    self.postMessage(data);
  });
`;
const blob = new Blob([script], { type: "application/javascript" });
const workerURL = URL.createObjectURL(blob);

async function fetchRepoManifest(url: string) {
  const worker = new Worker(workerURL);
  return new Promise((resolver) => {
    const resolve = (data) => {
      worker.terminate();
      resolver(data);
    };

    worker.postMessage(url);
    worker.addEventListener("message", (event) => resolve(event.data), { once: true });
    worker.addEventListener("error", () => resolve(null), { once: true });
  });
}

// TODO: add try/catch here?
// TODO: can we add a return type here?
/**
 * Get the manifest object for a repo
 * @param user Owner username
 * @param repo Repo name
 * @param branch Default branch name (e.g. main or master)
 * @returns The manifest object
 */
async function getRepoManifest(user: string, repo: string, branch: string): Promise<ParsedManifest[]> {
  const cacheKey = `manifest:${user}/${repo}@${branch}`;
  const cached = readCache<ParsedManifest[]>(cacheKey);

  if (cached && Array.isArray(cached.value)) {
    // Repos without a manifest are re-checked more often than repos with one
    const ttl = cached.value.length ? CACHE_TTL.manifest : CACHE_TTL.repo;
    if (cached.age <= ttl) return cached.value;
  }

  const url = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/manifest.json`;
  let manifests: ReturnType<typeof JSON.parse> = await fetchRepoManifest(url);

  if (!manifests) {
    // Fall back to the expired copy rather than dropping the repo from the grid entirely
    if (cached && Array.isArray(cached.value) && cached.value.length) return cached.value;
    writeCache(cacheKey, []);
    return [];
  }
  if (!Array.isArray(manifests)) manifests = [manifests];

  const parsedManifests: ParsedManifest[] = manifests.flatMap((manifest) => {
    const parsed = manifestSchema.safeParse(manifest);
    if (parsed.success) return [parsed.data];
    console.warn(`Invalid Marketplace manifest from ${user}/${repo}`, parsed.error);
    return [];
  });

  writeCache(cacheKey, parsedManifests);
  return parsedManifests;
}

// TODO: can we add a return type here?
/**
 * Fetch extensions from a repo and format data for generating cards
 * @param contents_url The repo's GitHub API contents_url (e.g. "https://api.github.com/repos/theRealPadster/spicetify-hide-podcasts/contents/{+path}")
 * @param branch The repo's default branch (e.g. main or master)
 * @param stars The number of stars the repo has
 * @param hideInstalled Whether to hide installed items or not (defaults to `false`)
 * @returns Extension info for card (or null)
 */
export async function fetchExtensionManifest(contents_url: string, branch: string, stars: number, hideInstalled = false) {
  try {
    // TODO: use the original search full_name ("theRealPadster/spicetify-hide-podcasts") or something to get the url better?
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    // TODO: err handling?
    if (!regex_result?.groups) return null;
    const { user, repo } = regex_result.groups;

    const manifests = await getRepoManifest(user, repo, branch);

    // Manifest is initially parsed
    const parsedManifests: CardItem[] = (manifests as ReturnType<typeof JSON.parse>[]).reduce((accum, manifest) => {
      // Check if manifest object is designated for Extensions
      if (manifest?.name && manifest.description && manifest.main) {
        const selectedBranch = manifest.branch || branch;
        const item = {
          manifest,
          title: manifest.name,
          subtitle: manifest.description,
          authors: processAuthors(manifest.authors, user),
          user,
          repo,
          branch: selectedBranch,

          imageURL: manifest.preview?.startsWith("http")
            ? manifest.preview
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.preview}`,
          extensionURL: manifest.main.startsWith("http")
            ? manifest.main
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.main}`,
          readmeURL: manifest.readme?.startsWith("http")
            ? manifest.readme
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.readme}`,
          stars,
          tags: manifest.tags
        };
        // Add to list unless we're hiding installed items and it's installed
        if (!(hideInstalled && marketplaceStorage.getItem(`marketplace:installed:${user}/${repo}/${manifest.main}`))) {
          accum.push(item);
        }
      }

      // else {
      //     console.error("Invalid manifest:", manifest);
      // }

      return accum;
    }, []);

    return parsedManifests;
  } catch {
    return null;
  }
}

// TODO: can we add a return type here?
/**
 * Fetch themes from a repo and format data for generating cards
 * @param contents_url The repo's GitHub API contents_url (e.g. "https://api.github.com/repos/theRealPadster/spicetify-hide-podcasts/contents/{+path}")
 * @param branch The repo's default branch (e.g. main or master)
 * @param stars The number of stars the repo has
 * @returns Extension info for card (or null)
 */
export async function fetchThemeManifest(contents_url: string, branch: string, stars: number) {
  try {
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    // TODO: err handling?
    if (!regex_result?.groups) return null;
    const { user, repo } = regex_result.groups;

    const manifests = await getRepoManifest(user, repo, branch);

    // Manifest is initially parsed
    // const parsedManifests: ThemeCardItem[] = manifests.reduce((accum, manifest) => {
    const parsedManifests: CardItem[] = (manifests as ReturnType<typeof JSON.parse>[]).reduce((accum, manifest) => {
      // Check if manifest object is designated for a Theme
      if (manifest?.name && manifest?.usercss && manifest?.description) {
        const selectedBranch = manifest.branch || branch;
        const item = {
          manifest,
          title: manifest.name,
          subtitle: manifest.description,
          authors: processAuthors(manifest.authors, user),
          user,
          repo,
          branch: selectedBranch,
          imageURL: manifest.preview?.startsWith("http")
            ? manifest.preview
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.preview}`,
          readmeURL: manifest.readme?.startsWith("http")
            ? manifest.readme
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.readme}`,
          stars,
          tags: manifest.tags,
          // theme stuff
          cssURL: manifest.usercss.startsWith("http")
            ? manifest.usercss
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.usercss}`,
          // TODO: clean up indentation etc
          schemesURL: manifest.schemes
            ? manifest.schemes.startsWith("http")
              ? manifest.schemes
              : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.schemes}`
            : null,
          include: manifest.include
        };
        // If manifest is valid, add it to the list

        accum.push(item);
      }

      return accum;
    }, []);
    return parsedManifests;
  } catch {
    return null;
  }
}

/**
 * Fetch custom apps from a repo and format data for generating cards
 * @param contents_url The repo's GitHub API contents_url (e.g. "https://api.github.com/repos/theRealPadster/spicetify-hide-podcasts/contents/{+path}")
 * @param branch The repo's default branch (e.g. main or master)
 * @param stars The number of stars the repo has
 * @returns Extension info for card (or null)
 */
export async function fetchAppManifest(contents_url: string, branch: string, stars: number) {
  try {
    // TODO: use the original search full_name ("theRealPadster/spicetify-hide-podcasts") or something to get the url better?
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    // TODO: err handling?
    if (!regex_result?.groups) return null;
    const { user, repo } = regex_result.groups;

    const manifests = await getRepoManifest(user, repo, branch);

    // Manifest is initially parsed
    const parsedManifests: CardItem[] = (manifests as ReturnType<typeof JSON.parse>[]).reduce((accum, manifest) => {
      // Check if manifest object is designated for a Custom App
      if (manifest?.name && manifest.description && !manifest.main && !manifest.usercss) {
        const selectedBranch = manifest.branch || branch;
        // TODO: tweak saved items
        const item = {
          manifest,
          title: manifest.name,
          subtitle: manifest.description,
          authors: processAuthors(manifest.authors, user),
          user,
          repo,
          branch: selectedBranch,

          imageURL: manifest.preview?.startsWith("http")
            ? manifest.preview
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.preview}`,
          // Custom Apps don't have an entry point; they're just listed so they can link out from the card
          // extensionURL: manifest.main.startsWith("http")
          //   ? manifest.main
          //   : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.main}`,
          readmeURL: manifest.readme?.startsWith("http")
            ? manifest.readme
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.readme}`,
          stars,
          tags: manifest.tags
        };

        // If manifest is valid, add it to the list

        accum.push(item);

        // else {
        //     console.error("Invalid manifest:", manifest);
        // }
      }
      return accum;
    }, []);

    return parsedManifests;
  } catch {
    return null;
  }
}

/**
 * It fetches the blacklist.json file from the GitHub repository and returns the array of blocked repos.
 * @returns String array of blacklisted repos
 */
export const getBlacklist = async () => {
  const { data } = await fetchJsonResource<{ repos?: unknown }>(BLACKLIST_URL, {
    cacheKey: "blacklist",
    ttlMs: CACHE_TTL.resource
  });

  if (!Array.isArray(data?.repos)) return [];
  return data.repos.filter((repo): repo is string => typeof repo === "string");
};

/**
 * It fetches the snippets.json file from the Github repository and returns it as an array of snippets.
 * @returns Array of snippets
 */
export const fetchCssSnippets = async (hideInstalled = false) => {
  const { data } = await fetchJsonResource<unknown>(SNIPPETS_URL, {
    cacheKey: "snippets",
    ttlMs: CACHE_TTL.resource
  });

  if (!Array.isArray(data) || !data.length) return [];

  const snippets = data.reduce<Snippet[]>((accum, rawSnippet) => {
    const parsed = snippetSchema.safeParse(rawSnippet);
    if (!parsed.success) {
      console.warn("Invalid Marketplace snippet", parsed.error);
      return accum;
    }

    const snip = { ...parsed.data } as unknown as Snippet;

    // Because the card component looks for an imageURL prop
    if (snip.preview) {
      snip.imageURL = snip.preview.startsWith("http")
        ? snip.preview
        : `https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/${snip.preview}`;
      snip.preview = undefined;
    }

    // Hide installed snippets if option is set and it's installed
    if (!(hideInstalled && marketplaceStorage.getItem(`marketplace:installed:snippet:${snip.title.replaceAll(" ", "-")}`))) {
      accum.push(snip);
    }

    return accum;
  }, []);

  return snippets;
};
