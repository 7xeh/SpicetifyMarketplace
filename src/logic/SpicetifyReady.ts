const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 15000;

type Requirement = {
  name: string;
  isReady: () => boolean;
};

const REQUIREMENTS: Requirement[] = [
  { name: "Spicetify.Platform.History", isReady: () => Boolean(Spicetify?.Platform?.History?.location) },
  { name: "Spicetify.ReactComponent.Menu", isReady: () => Boolean(Spicetify?.ReactComponent?.Menu) },
  { name: "Spicetify.Locale", isReady: () => typeof Spicetify?.Locale?.getLocale === "function" },
  { name: "Spicetify.showNotification", isReady: () => typeof Spicetify?.showNotification === "function" },
  { name: "Spicetify.Config", isReady: () => Boolean(Spicetify?.Config) }
];

function missingRequirements() {
  return REQUIREMENTS.filter((requirement) => {
    try {
      return !requirement.isReady();
    } catch {
      return true;
    }
  }).map((requirement) => requirement.name);
}

export function isSpicetifyReady() {
  return missingRequirements().length === 0;
}

export function waitForSpicetify(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  if (isSpicetifyReady()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    const poll = () => {
      if (isSpicetifyReady()) {
        resolve(true);
        return;
      }

      if (Date.now() >= deadline) {
        console.warn(`Marketplace: timed out waiting for ${missingRequirements().join(", ")}`);
        resolve(false);
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    };

    setTimeout(poll, POLL_INTERVAL_MS);
  });
}
