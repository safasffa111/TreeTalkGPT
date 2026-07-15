const REPO = 'safasffa111/TreeTalkGPT';
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;

const $ = (selector) => document.querySelector(selector);

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
};

const assetBy = (assets, checks) => assets.find((asset) => {
  const name = asset.name.toLowerCase();
  return checks.every((check) => check(name));
});

const setAsset = (linkSelector, metaSelector, asset, fallbackText) => {
  const link = $(linkSelector);
  const meta = $(metaSelector);
  if (!link || !meta) return;
  if (asset) {
    link.href = asset.browser_download_url;
    link.setAttribute('download', '');
    const size = formatBytes(asset.size);
    meta.textContent = [size, `${asset.download_count ?? 0} 次下载`].filter(Boolean).join(' · ');
  } else {
    link.href = RELEASE_PAGE;
    link.removeAttribute('download');
    meta.textContent = fallbackText;
  }
};

const applyPrimaryDownload = ({ windows, macArm, macIntel }) => {
  const primary = $('[data-primary-download]');
  if (!primary) return;
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  const normalized = String(platform).toLowerCase();
  let asset;
  let label = '查看最新版下载';
  if (normalized.includes('win')) {
    asset = windows;
    label = '下载 Windows 版';
  } else if (normalized.includes('mac')) {
    const isArm = /arm|apple/.test(normalized) || navigator.userAgent.includes('Macintosh');
    asset = isArm ? (macArm || macIntel) : (macIntel || macArm);
    label = '下载 macOS 版';
  }
  primary.href = asset?.browser_download_url || RELEASE_PAGE;
  primary.textContent = label;
};

const loadRelease = async () => {
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const windows = assetBy(assets, [(n) => n.endsWith('.exe'), (n) => n.includes('windows') || n.includes('win')]);
    const macArm = assetBy(assets, [(n) => n.endsWith('.dmg') || n.endsWith('.zip'), (n) => n.includes('arm64') || n.includes('apple-silicon')]);
    const macIntel = assetBy(assets, [(n) => n.endsWith('.dmg') || n.endsWith('.zip'), (n) => n.includes('x64') || n.includes('intel'), (n) => n.includes('mac')]);

    setAsset('[data-win-download]', '[data-win-meta]', windows, '前往发布页选择 Windows 文件');
    setAsset('[data-mac-arm-download]', '[data-mac-arm-meta]', macArm, '前往发布页选择 Apple Silicon 文件');
    setAsset('[data-mac-intel-download]', '[data-mac-intel-meta]', macIntel, '前往发布页选择 Intel 文件');
    applyPrimaryDownload({ windows, macArm, macIntel });

    const tag = release.tag_name || release.name || '最新版';
    const published = release.published_at ? new Date(release.published_at) : null;
    $('[data-release-label]').textContent = `${tag} 已发布`;
    $('[data-version]').textContent = tag;
    $('[data-release-date]').textContent = published && !Number.isNaN(published.valueOf())
      ? `${published.toLocaleDateString('zh-CN')} 发布`
      : '最新公开版本';
  } catch (error) {
    console.warn('Unable to load latest release:', error);
    $('[data-release-label]').textContent = '前往 GitHub 获取最新版';
    $('[data-release-date]').textContent = '发布信息暂时无法同步';
    applyPrimaryDownload({});
  }
};

const header = $('[data-header]');
const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 20);
window.addEventListener('scroll', updateHeader, { passive: true });
updateHeader();

$('[data-year]').textContent = new Date().getFullYear();
loadRelease();