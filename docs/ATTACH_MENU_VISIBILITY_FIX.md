# 附件菜单显示修复

## 问题

上一版为了防止附件菜单被左侧辅助栏遮挡，使用了 JS 动态计算 `left/top`，但菜单仍然是 `position: absolute`。

`getBoundingClientRect()` 得到的是视口坐标，而 `absolute` 的 `left/top` 会相对于 `.prompt-dock` 这类定位父级生效，坐标系不一致，导致菜单可能被放到不可见区域，看起来像点击加号后附件列表不显示。

## 修复

- `.attach-menu` 改为 `position: fixed`。
- JS 计算的 `left/top` 继续使用视口坐标。
- 同时写入 CSS 变量和 inline `left/top`，增加兜底稳定性。
- 仍保留 workspace 边界 clamp，避免菜单滑到辅助栏下方。

## 影响

只影响附件菜单显示位置，不改变附件上传、富文本开关、托盘渲染等功能。
