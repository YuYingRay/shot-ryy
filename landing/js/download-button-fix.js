(function () {
  var DOWNLOAD_BUTTON_SELECTOR = ".framer-1uqo2rx-container button";
  var DOWNLOAD_BUTTON_CONTAINER_SELECTOR = ".framer-1uqo2rx-container";
  var FOOTER_DOWNLOAD_LINK_SELECTOR = [
    'a[href="https://github.com/webadderall/Shot/releases"]',
    'a[href="https://github.com/webadderall/shot/releases"]'
  ].join(", ");
  var WINDOWS_DOWNLOAD_LINK_SELECTOR = ".framer-12f0ep3-container a";
  var MACOS_DOWNLOAD_LINK_SELECTOR = ".framer-ek7kdh-container a";
  var RELEASES_PAGE_URL = "https://github.com/webadderall/shot/releases";
  var LATEST_RELEASE_API_URL = "https://api.github.com/repos/webadderall/shot/releases/latest";
  var TAG_RELEASE_URL_PREFIX = "https://github.com/webadderall/shot/releases/tag/";
  var latestReleasePromise;

  function detectPlatform() {
    var platform = "";
    var userAgent = "";

    if (navigator.userAgentData && navigator.userAgentData.platform) {
      platform = String(navigator.userAgentData.platform).toLowerCase();
    }

    if (!platform && navigator.platform) {
      platform = String(navigator.platform).toLowerCase();
    }

    if (navigator.userAgent) {
      userAgent = String(navigator.userAgent).toLowerCase();
    }

    var combined = (platform + " " + userAgent).trim();

    if (/win|windows/.test(combined)) {
      return "windows";
    }

    if (/mac|macos|macintosh|darwin/.test(combined)) {
      return "macos";
    }

    if (/linux|x11|ubuntu|debian|fedora/.test(combined)) {
      return "linux";
    }

    return "unknown";
  }

  function getButtonLabel(platform) {
    if (platform === "windows") {
      return "Download for Windows";
    }

    if (platform === "macos") {
      return "Download for macOS";
    }

    return "View Downloads";
  }

  function getButtonAriaLabel(platform) {
    if (platform === "windows") {
      return "Download for Windows";
    }

    if (platform === "macos") {
      return "Download for macOS";
    }

    return "View downloads";
  }

  function getPreferredAssetMatchers(platform) {
    if (platform === "windows") {
      return [
        /windows.*\.exe$/i,
        /windows.*\.msi$/i,
        /\.exe$/i,
        /\.msi$/i,
      ];
    }

    if (platform === "macos") {
      return [
        /darwin.*\.dmg$/i,
        /mac.*\.dmg$/i,
        /\.dmg$/i,
        /darwin.*\.zip$/i,
        /mac.*\.zip$/i,
        /\.zip$/i,
        /app\.tar\.gz$/i,
      ];
    }

    if (platform === "linux") {
      return [
        /linux.*\.appimage$/i,
        /linux.*\.deb$/i,
        /linux.*\.rpm$/i,
        /\.appimage$/i,
        /\.deb$/i,
        /\.rpm$/i,
        /linux.*\.tar\.gz$/i,
      ];
    }

    return [];
  }

  function isDownloadableAsset(asset) {
    if (!asset || !asset.name || !asset.browser_download_url) {
      return false;
    }

    return !/\.(sig|json|txt)$/i.test(asset.name);
  }

  function getReleasePageUrl(release) {
    if (!release || !release.tag_name) {
      return RELEASES_PAGE_URL;
    }

    return TAG_RELEASE_URL_PREFIX + encodeURIComponent(release.tag_name);
  }

  function pickReleaseAsset(release, platform) {
    if (!release || !Array.isArray(release.assets)) {
      return null;
    }

    var assets = release.assets.filter(isDownloadableAsset);
    var matchers = getPreferredAssetMatchers(platform);

    for (var index = 0; index < matchers.length; index += 1) {
      var matcher = matchers[index];
      var match = assets.find(function (asset) {
        return matcher.test(asset.name);
      });

      if (match) {
        return match;
      }
    }

    return null;
  }

  function getAssetUrlForPlatform(release, platform) {
    var asset = pickReleaseAsset(release, platform);
    if (asset && asset.browser_download_url) {
      return asset.browser_download_url;
    }

    return getReleasePageUrl(release);
  }

  function getLatestRelease() {
    if (!latestReleasePromise) {
      latestReleasePromise = fetch(LATEST_RELEASE_API_URL, {
        headers: {
          Accept: "application/vnd.github+json",
        },
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Could not load latest release metadata");
          }

          return response.json();
        })
        .catch(function () {
          return null;
        });
    }

    return latestReleasePromise;
  }

  function resolveDownloadUrl(platform) {
    return getLatestRelease().then(function (release) {
      if (!release) {
        return RELEASES_PAGE_URL;
      }

      return getAssetUrlForPlatform(release, platform);
    });
  }

  function styleButton(button) {
    var container = button.closest(DOWNLOAD_BUTTON_CONTAINER_SELECTOR);
    var icons = button.querySelectorAll("svg");

    icons.forEach(function (icon) {
      icon.remove();
    });

    button.style.gap = "0px";
    button.style.padding = "16px 36px 16px 24px";

    if (container) {
      container.style.marginRight = "16px";
    }
  }

  function updateLinkTarget(link, url, label) {
    if (!link || !url) {
      return;
    }

    link.href = url;

    if (label) {
      link.setAttribute("aria-label", label);
      link.title = label;
    }
  }

  function updateSupportingDownloadLinks() {
    return getLatestRelease().then(function (release) {
      var releasePageUrl = getReleasePageUrl(release);
      var footerLinks = document.querySelectorAll(FOOTER_DOWNLOAD_LINK_SELECTOR);
      var windowsLinks = document.querySelectorAll(WINDOWS_DOWNLOAD_LINK_SELECTOR);
      var macosLinks = document.querySelectorAll(MACOS_DOWNLOAD_LINK_SELECTOR);
      var windowsUrl = release ? getAssetUrlForPlatform(release, "windows") : releasePageUrl;
      var macosUrl = release ? getAssetUrlForPlatform(release, "macos") : releasePageUrl;

      footerLinks.forEach(function (link) {
        updateLinkTarget(link, releasePageUrl, "View Shot downloads");
      });

      windowsLinks.forEach(function (link) {
        updateLinkTarget(link, windowsUrl, "Download Shot for Windows");
      });

      macosLinks.forEach(function (link) {
        updateLinkTarget(link, macosUrl, "Download Shot for macOS");
      });
    });
  }

  function updateButton(button) {
    if (!button) {
      return;
    }

    var platform = detectPlatform();
    var label = getButtonLabel(platform);
    var textNode = button.querySelector("span");

    button.dataset.shotDownloadButton = "true";
    button.setAttribute("aria-label", getButtonAriaLabel(platform));
    button.title = label;
    styleButton(button);

    if (textNode) {
      textNode.textContent = label;
    }
  }

  function openDownload(button) {
    if (!button || button.dataset.shotDownloadLoading === "true") {
      return;
    }

    var platform = detectPlatform();
    var textNode = button.querySelector("span");
    var originalText = textNode ? textNode.textContent : "";

    button.dataset.shotDownloadLoading = "true";

    if (textNode) {
      textNode.textContent = "Opening download...";
    }

    resolveDownloadUrl(platform)
      .then(function (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      })
      .finally(function () {
        delete button.dataset.shotDownloadLoading;
        if (textNode) {
          textNode.textContent = originalText;
        }
        updateButton(button);
      });
  }

  function enhanceButton(button) {
    if (!button || button.dataset.shotDownloadEnhanced === "true") {
      return;
    }

    button.dataset.shotDownloadEnhanced = "true";
    updateButton(button);

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openDownload(button);
    });

    button.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openDownload(button);
    });
  }

  function enhanceButtons() {
    var buttons = document.querySelectorAll(DOWNLOAD_BUTTON_SELECTOR);
    buttons.forEach(enhanceButton);
    updateSupportingDownloadLinks();
  }

  function startObserver() {
    if (!document.body || typeof MutationObserver === "undefined") {
      return;
    }

    var observer = new MutationObserver(function () {
      enhanceButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      enhanceButtons();
      startObserver();
    });
  } else {
    enhanceButtons();
    startObserver();
  }
})();
