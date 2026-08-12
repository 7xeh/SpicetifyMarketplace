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

export async function getTaggedRepos(tag: RepoTopic, page = 1, BLACKLIST: string[] = [], showArchived = false) {
  let url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`topic:${tag}`)}&per_page=${ITEMS_PER_REQUEST}`;

  if (page) url += `&page=${page}`;

  const { data, rateLimited } = await fetchGitHubJson<SearchResponse>(url, {
    cacheKey: `${tag}-page-${page || 1}`,
    ttlMs: CACHE_TTL.searchPage
  });

  if (!data || !Array.isArray(data.items)) {
    if (!rateLimited) Spicetify.showNotification(t("notifications.tooManyRequests"), true, 5000);
    return { items: [] as SearchRepo[], total_count: 0, page_count: 0 };
  }

  const repos = data.items.filter(isSearchRepo);

  return {
    total_count: typeof data.total_count === "number" ? data.total_count : repos.length,
    page_count: repos.length,
    items: repos.filter((item) => !isBlacklisted(item.html_url, BLACKLIST) && (showArchived || !item.archived))
  };
}

const script = `
  self.addEventListener('message', async (event) => {
    const url = event.data;
    try {
      const response = await fetch(url);
      const data = response.ok ? await response.json().catch(() => null) : null;
      self.postMessage(data);
    } catch {
      self.postMessage(null);
    }
  });
`;
const blob = new Blob([script], { type: "application/javascript" });
const workerURL = URL.createObjectURL(blob);

const MANIFEST_TIMEOUT_MS = 15000;

async function fetchRepoManifest(url: string) {
  const worker = new Worker(workerURL);
  return new Promise((resolver) => {
    let settled = false;

    const resolve = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolver(data);
    };

    const timer = setTimeout(() => {
      console.warn(`Marketplace: timed out fetching ${url}`);
      resolve(null);
    }, MANIFEST_TIMEOUT_MS);

    worker.postMessage(url);
    worker.addEventListener("message", (event) => resolve(event.data), { once: true });
    worker.addEventListener("error", () => resolve(null), { once: true });
  });
}

async function getRepoManifest(user: string, repo: string, branch: string): Promise<ParsedManifest[]> {
  const cacheKey = `manifest:${user}/${repo}@${branch}`;
  const cached = readCache<ParsedManifest[]>(cacheKey);

  if (cached && Array.isArray(cached.value)) {
    const ttl = cached.value.length ? CACHE_TTL.manifest : CACHE_TTL.repo;
    if (cached.age <= ttl) return cached.value;
  }

  const url = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/manifest.json`;
  let manifests: ReturnType<typeof JSON.parse> = await fetchRepoManifest(url);

  if (!manifests) {
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

export async function fetchExtensionManifest(contents_url: string, branch: string, stars: number, hideInstalled = false) {
  try {
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    if (!regex_result?.groups) return null;
    const { user, repo } = regex_result.groups;

    const manifests = await getRepoManifest(user, repo, branch);

    const parsedManifests: CardItem[] = (manifests as ReturnType<typeof JSON.parse>[]).reduce((accum, manifest) => {
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
        if (!(hideInstalled && marketplaceStorage.getItem(`marketplace:installed:${user}/${repo}/${manifest.main}`))) {
          accum.push(item);
        }
      }

      return accum;
    }, []);

    return parsedManifests;
  } catch {
    return null;
  }
}

export async function fetchThemeManifest(contents_url: string, branch: string, stars: number) {
  try {
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    if (!regex_result?.groups) return null;
    const { user, repo } = regex_result.groups;

    const manifests = await getRepoManifest(user, repo, branch);

    const parsedManifests: CardItem[] = (manifests as ReturnType<typeof JSON.parse>[]).reduce((accum, manifest) => {
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
          cssURL: manifest.usercss.startsWith("http")
            ? manifest.usercss
            : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.usercss}`,
          schemesURL: manifest.schemes
            ? manifest.schemes.startsWith("http")
              ? manifest.schemes
              : `https://raw.githubusercontent.com/${user}/${repo}/${selectedBranch}/${manifest.schemes}`
            : null,
          include: manifest.include
        };

        accum.push(item);
      }

      return accum;
    }, []);
    return parsedManifests;
  } catch {
    return null;
  }
}

export async function fetchAppManifest(contents_url: string, branch: string, stars: number) {
  try {
    const regex_result = contents_url.match(/https:\/\/api\.github\.com\/repos\/(?<user>.+)\/(?<repo>.+)\/contents/);
    if (!regex_result?.groups) return null;
    const { user, repo } = regex_result.groups;

    const manifests = await getRepoManifest(user, repo, branch);

    const parsedManifests: CardItem[] = (manifests as ReturnType<typeof JSON.parse>[]).reduce((accum, manifest) => {
      if (manifest?.name && manifest.description && !manifest.main && !manifest.usercss) {
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
          tags: manifest.tags
        };

        accum.push(item);
      }
      return accum;
    }, []);

    return parsedManifests;
  } catch {
    return null;
  }
}

export const getBlacklist = async () => {
  const { data } = await fetchJsonResource<{ repos?: unknown }>(BLACKLIST_URL, {
    cacheKey: "blacklist",
    ttlMs: CACHE_TTL.resource
  });

  if (!Array.isArray(data?.repos)) return [];
  return data.repos.filter((repo): repo is string => typeof repo === "string");
};

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

    if (snip.preview) {
      snip.imageURL = snip.preview.startsWith("http")
        ? snip.preview
        : `https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/${snip.preview}`;
      snip.preview = undefined;
    }

    if (!(hideInstalled && marketplaceStorage.getItem(`marketplace:installed:snippet:${snip.title.replaceAll(" ", "-")}`))) {
      accum.push(snip);
    }

    return accum;
  }, []);

  return snippets;
};
