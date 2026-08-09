#!/bin/sh
# Copyright 2019 khanhas. GPL license.
# Edited from project Denoland install script (https://github.com/denoland/deno_install)

set -e

REPO="${MARKETPLACE_REPO:-7xeh/SpicetifyMarketplace}"
BRANCH="${MARKETPLACE_BRANCH:-main}"
FROM_SOURCE="${MARKETPLACE_FROM_SOURCE:-0}"
UNINSTALL_ONLY="${MARKETPLACE_UNINSTALL_ONLY:-0}"

releases_uri="https://github.com/$REPO/releases"
default_color_uri="https://raw.githubusercontent.com/$REPO/$BRANCH/resources/color.ini"

tag=""
if [ $# -gt 0 ]; then
	tag=$1
fi

SPICETIFY_CONFIG_DIR="$SPICETIFY_CONFIG"
if [ -z "$SPICETIFY_CONFIG_DIR" ]; then
	SPICETIFY_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/spicetify"
fi
INSTALL_DIR="$SPICETIFY_CONFIG_DIR/CustomApps"
THEME_DIR="$SPICETIFY_CONFIG_DIR/Themes/marketplace"

current_theme=$(spicetify config current_theme 2>/dev/null || echo "")

remove_existing_marketplace() {
	found=0

	for app_name in marketplace spicetify-marketplace; do
		if [ -d "$INSTALL_DIR/$app_name" ]; then
			echo "  - removing CustomApps/$app_name"
			rm -rf "$INSTALL_DIR/$app_name"
			found=1
		fi
	done

	configured_apps=$(spicetify config custom_apps 2>/dev/null || echo "")
	configured_apps=${configured_apps##*=}
	configured_apps=$(echo "$configured_apps" | tr -d '[:space:]' | tr ',' '|')

	for app_name in marketplace spicetify-marketplace; do
		case "|$configured_apps|" in
		*"|$app_name|"*)
			echo "  - removing '$app_name' from custom_apps"
			spicetify config custom_apps "$app_name-" >/dev/null 2>&1 || true
			found=1
			;;
		esac
	done

	if [ -d "$THEME_DIR" ]; then
		echo "  - removing stale placeholder theme"
		if [ "$current_theme" = "marketplace" ]; then
			rm -f "$THEME_DIR/user.css"
		else
			rm -rf "$THEME_DIR"
		fi
		found=1
	fi

	if [ "$found" -eq 0 ]; then
		echo "  - nothing found"
	fi
}

resolve_release_asset() {
	# Release downloads are served straight from github.com and are not subject to the API rate limit
	if [ -n "$tag" ]; then
		download_uri="$releases_uri/download/$tag/marketplace.zip"
	else
		download_uri="$releases_uri/latest/download/marketplace.zip"
	fi

	status=$(curl -sIL -o /dev/null -w '%{http_code}' "$download_uri" 2>/dev/null || echo "000")

	if [ "$status" = "200" ]; then
		return 0
	fi

	if [ "$status" = "404" ]; then
		echo "No marketplace.zip attached to the requested release of $REPO."
	else
		echo "Could not reach the release download for $REPO (HTTP $status)."
	fi
	return 1
}

build_from_source() {
	if ! command -v node >/dev/null 2>&1; then
		echo "ERROR: Node.js is required to build $REPO from source."
		echo "Install Node 24+, or publish a release with a marketplace.zip asset."
		exit 1
	fi

	if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
		corepack enable pnpm >/dev/null 2>&1 || true
	fi

	if ! command -v pnpm >/dev/null 2>&1; then
		echo "ERROR: pnpm is required to build from source. Install it with: npm install -g pnpm"
		exit 1
	fi

	source_uri="https://github.com/$REPO/archive/refs/heads/$BRANCH.zip"
	echo "DOWNLOADING SOURCE $source_uri"
	curl --fail --location --progress-bar --output "$WORK_DIR/source.zip" "$source_uri"

	unzip -q -d "$WORK_DIR/source" -o "$WORK_DIR/source.zip"
	source_root=$(find "$WORK_DIR/source" -mindepth 1 -maxdepth 1 -type d | head -n 1)
	if [ -z "$source_root" ]; then
		echo "ERROR: could not find the extracted source directory."
		exit 1
	fi

	echo "BUILDING (this can take a minute)"
	(cd "$source_root" && pnpm install --frozen-lockfile && pnpm build:local)

	if [ ! -f "$source_root/dist/index.js" ]; then
		echo "ERROR: the build finished but no dist/index.js was produced."
		exit 1
	fi

	DIST_DIR="$source_root/dist"
}

echo "SOURCE $REPO ($BRANCH)"
echo "CHECKING FOR AN EXISTING MARKETPLACE"
remove_existing_marketplace

if [ "$UNINSTALL_ONLY" = "1" ]; then
	spicetify apply
	echo "Marketplace has been removed."
	echo "Its settings and installed items live inside Spotify and are not touched by this script."
	exit 0
fi

if [ ! -d "$INSTALL_DIR" ]; then
	echo "MAKING FOLDER  $INSTALL_DIR"
	mkdir -p "$INSTALL_DIR"
fi

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/marketplace-install.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

DIST_DIR=""
if [ "$FROM_SOURCE" != "1" ] && resolve_release_asset; then
	echo "DOWNLOADING $download_uri"
	curl --fail --location --progress-bar --output "$WORK_DIR/marketplace.zip" "$download_uri"

	echo "EXTRACTING"
	unzip -q -d "$WORK_DIR/unpacked" -o "$WORK_DIR/marketplace.zip"

	dist_manifest=$(find "$WORK_DIR/unpacked" -maxdepth 3 -name manifest.json -type f | head -n 1)
	if [ -z "$dist_manifest" ]; then
		echo "ERROR: the release archive does not contain a manifest.json."
		exit 1
	fi
	DIST_DIR=$(dirname "$dist_manifest")
else
	if [ "$FROM_SOURCE" != "1" ]; then
		echo "No marketplace.zip release asset found on $REPO; building from source instead."
	fi
	build_from_source
fi

echo "COPYING"
mkdir -p "$INSTALL_DIR/marketplace"
cp -R "$DIST_DIR/." "$INSTALL_DIR/marketplace/"

echo "INSTALLING"

# Color injection fix
spicetify config inject_css 1
spicetify config replace_colors 1

if [ ${#current_theme} -le 3 ] || [ "$current_theme" = "marketplace" ]; then
	echo "Using placeholder theme so Marketplace themes can be installed"
	if [ ! -d "$THEME_DIR" ]; then
		echo "MAKING FOLDER  $THEME_DIR"
		mkdir -p "$THEME_DIR"
	fi
	if ! curl --fail --location --progress-bar --output "$THEME_DIR/color.ini" "$default_color_uri"; then
		echo "Could not download the placeholder theme from the fork, falling back to upstream."
		curl --fail --location --progress-bar --output "$THEME_DIR/color.ini" \
			"https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini"
	fi
	spicetify config current_theme marketplace
fi

if spicetify config custom_apps marketplace; then
	echo "Added to config!"
	echo "APPLYING"
	spicetify apply
	echo "Installed $REPO ($BRANCH) into $INSTALL_DIR/marketplace"
else
	echo "Command failed"
	echo "Please run \`spicetify config custom_apps marketplace\` manually "
	echo "Next run \`spicetify apply\`"
fi
