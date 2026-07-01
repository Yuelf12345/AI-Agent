# 兼容问题

## 兼容问题 - 扫描规则

---

### Q1：【ios17 积木页无法返回】从活动页进入积木页后，无法返回到活动页

- **记录人**：@刘明
- **项目**：通用问题，24 春季盛典发现
- **详情参见**：[2023-11]「IOS 17」- IOS 系统升级后已知 web 相关 bug 同步

**A**：当前，活动中的外跳行为统一封装在 `goOtherPage` 函数中（这个会下沉到 `@live/actions` 里）：

1. 对于活动 tabs 一级页（底部 tab）中的积木入口，用 `jimu` 类型。因为在横切时采用的是 `router.replace` 模式。其他场景都用 `jimu_location` 类型即可。
2. 极端情况：尝试切换下模式（因为我们的测试覆盖面肯定是不全的，现有测试中都满足）。
3. 本质问题：iOS 17+ 以上机器有这个问题，通过 `replace` 进入的页面采用 `jimu` 类型，通过 `router.push` 进入的页面采用 `jimu_location` 类型。
4. 积木后端策略：如果我们携带了 `jimuBackUrl`，在 iOS 17+，积木采用 `window.location.replace(jimuBackUrl)`；其他场景都用 `history.back()`。

---

### Q2：【宽屏】【clientWidth】使用 clientWidth 时需要兼容宽屏情况

- **记录人**：@郭钊
- **项目**：通用问题，2024 夏季盛典发现

**问题详情**：当需要使用 JS 计算 CSS 样式值时（比如元素高度），为了兼容不同屏幕，一般是使用：`设计稿值 * document.body.clientWidth / 414`。但是！所有营收活动中都设置了 `#app` 的最大宽度为 828px，因此，当为宽屏设备时，`clientWidth` 并不是页面展示的真实宽度。

**A**：使用 JS 计算动态样式值写法，应该是：

```js
设计稿值 * Math.min(document.body.clientWidth, 828) / 414
```

---

### Q3：【折叠屏】【弹窗】折叠屏下全局弹窗关闭按钮被屏幕边缘遮挡住，无法通过点击按钮关闭

- **记录人**：@王宇飞
- **项目**：通用问题，2024 夏季盛典发现

**A**：媒体查询参数区分是否为折叠屏，折叠屏下弹窗缩小 80%。

```css
/* 当屏幕宽高比大于或等于0.8时，兼容折叠屏 */
@media (min-aspect-ratio: 0.8) {
  .modal {
    transform: scale(0.8);
  }
}
```

---

### Q4：渐变背景实现字体在 `display:flex` 情况下，部分机型字体消失

- **记录人**：@辛洋汐
- **项目**：通用问题，夏季盛典发现

**A**：字体背景色和 `display:flex` 分成两个 DOM 层级：

```html
<div class="flex">
  <span class="font-bg">背景色文字</span>
</div>
```

---

### Q5：`absolute` 布局的 div 没有写 `left` 或 `top`，在部分 iOS 手机上样式会解析成 `left:0` 或 `top:0` 导致样式错乱

- **记录人**：@周纤纤
- **项目**：通用问题

**A**：需要补充 `left` / `top` 属性。

---

### Q6：`width` 设置成 `max-content` 时，iOS 部分手机会出现折行问题

- **记录人**：@周纤纤
- **项目**：通用问题

**A**：此处可以不设 `width`，设置一个 `white-space: nowrap`，宽度即会以实际内容为宽；还有 `inherit` 也有类似的问题，在于部分 iOS 对宽度的渲染不同，不要写 `width: inherit;`。

---

### Q7：红米手机 `progress` 的 `background` 用 `#` 写的透明色，不生效

- **记录人**：@周纤纤

**A**：不能设置透明的 `#` 格式，需要设置成 `rgba` 格式。

---

### Q8：【渐变文字】【ios】部分 iOS 上，渐变文字不展示

- **记录人**：v1 @郭钊，v2 @李杰
- **项目**：24 年度盛典

**问题详情**：在 iPhone 11（旧版 iOS WebKit）上，底部导航预热态文案（带渐变文字效果）在激活态时会出现文字完全不显示的情况，看起来像是"字体背景色不展示"。

- **影响范围**：仅出现在部分旧版 iOS / iPhone 11 WebView（Safari 内核）环境中，其他浏览器与新系统正常。

**问题代码**：

```html
<div class="a-text-nav-active">
  <span class="is-warm-up">
    <span class="warm-up-btn-text">预热文案</span>
    <img class="warm-up-tips-icon" />
  </span>
</div>
```

- `.a-text-nav-active`：导航激活态文字容器，负责渐变文字效果。
- `.is-warm-up`：预热态 wrapper，内部使用 `display: flex` 布局，文字 + 图标横向排列。
- `.warm-up-btn-text`：真正展示文案的文本节点。
- `.warm-up-tips-icon`：预热态小图标。

**修复方案**（简化结构）：

```less
:deep(.a-text-nav-active) {
    background: linear-gradient(180deg, #fff8ea 0%, #ffcd94 100%);
    color: transparent;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    -webkit-background-clip: text;
}

// 当 a-text-nav-active 包含 is-warm-up 时，将渐变效果应用到内部 span
:deep(.a-text-nav-active .is-warm-up) {
    background: inherit;
    color: inherit;
    .warm-up-btn-text {
        background: linear-gradient(180deg, #fff8ea 0%, #ffcd94 100%);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }
}
```

**关键改动点**：

1. `.a-text-nav-active .is-warm-up`：
   - 仅作为布局容器（flex），不再在该层叠加新的透明文字 + 渐变裁剪；
   - 使用 `background: inherit; color: inherit;`，保持普通的背景/颜色行为。
2. `.warm-up-btn-text`：
   - 作为真正的渐变文字节点；
   - 独立承载 `background: linear-gradient(...)` + `background-clip:text` + `-webkit-text-fill-color:transparent`；
   - 自身为一个简单的文本 `span`，不再承担 flex/复杂布局。

**总结**（iOS bug 描述）：

本问题与社区已有的 Safari/iOS 渐变文本 Bug 有明显相似之处：

- [Safari on iOS not displaying text when using background-clip and text-fill-color](https://stackoverflow.com/questions/44963978/safari-on-ios-not-displaying-text-when-using-background-clip-and-text-fill-color)
- [CSS gradient text are not visible on Safari](https://stackoverflow.com/questions/70201883/css-gradient-text-are-not-visible-on-safari)
- [Transparent linear-gradient applied to text – bug in Safari](https://stackoverflow.com/questions/45136387/transparent-linear-gradient-applied-to-text-bug-in-safari/45136579)

这些讨论中的共识包括：

- 使用 `background-clip:text + -webkit-text-fill-color:transparent` 在 Safari/iOS 上存在长期兼容性问题；
- 当与伪元素、复杂布局（flex）、嵌套容器等叠加时，文本可能完全不渲染；
- 官方未彻底修复，业界常见做法是：
  - 减少渐变文字作用元素的复杂度；
  - 将渐变裁剪限定在最内层的文本节点；
  - 必要时避免在复杂容器上直接应用透明文字 + text-clip 组合。

**根本原因**：

旧版 iOS WebKit 在处理「渐变文字（`background-clip:text + -webkit-text-fill-color:transparent`）+ 复杂布局（flex + 多层 wrapper）」组合时，内部绘制/合成层逻辑存在 Bug，导致文字整块区域被当作「全透明」跳过绘制，从而表现为"字体背景色不展示 / 文字消失"。

**修复思路**：

- 拆分布局与渐变裁剪职责；
- 把渐变文字效果从容器层下沉到最内层纯文本节点；
- 降低参与渐变裁剪节点的结构/布局复杂度，从而规避 WebKit 的渲染缺陷。

> **线下缺陷**：【打卡任务】集星记录没有标题

---

### Q9：【输入框】【ios】想修改输入框中间的值，手机插入选中不了

- **记录人**：@郭钊
- **项目**：通用问题

**A**：安卓正常，iOS 需要长按输入框中的任意位置，直到出现放大镜图标，这时你可以精确地移动光标到所需位置。

> **线下缺陷**：【打卡任务】想修改中间的值，手机插入选中不了

---

### Q10：CSS `transform: rotateY(180deg)` 翻转图标，iOS 手机上偶现不展示

- **记录人**：@周纤纤

**A**：给父元素加一个 `perspective: 1000px` 即可。

```css
.parent {
  perspective: 1000px;
}
```

---

### Q11：iOS 13 系统 BetterScroll 1.x 版本，sharp-ui 的 Scroll 组件，在 iOS 13 快速滑动时会出现回弹现象

- **记录人**：@周纤纤

**A**：iOS 13 系统自身对 `transition` 支持问题，针对 iOS 13 配置 BS 属性 `useTransition = false`。

---

### Q12：iOS 页面后退时，上一个页面不会刷新，被缓存，导致一些异常

- **记录人**：@周纤纤

**A**：

- **第一种方案**：跳转过去的那个页面不走浏览器的返回方式，走 `location.href` 即可。
- **第二种方案（不推荐）**：监听 `onpageshow`。

---

### Q13：iOS 17 手机，对某个类进行 `transform: translateX(95px) !important` 覆盖，会先在 0 位置闪烁一下

- **记录人**：@周纤纤

**A**：改成使用 `margin-left`。

---

### Q14：iOS 手机间外滑动屏幕会触发系统返回问题，iOS 返回手势冲突

- **记录人**：@周纤纤

**A**：Yoda 提供了一个桥，设置页面是否开启滑动返回，可以在间外的时候设置打开，但为了不影响其他页面能力，应该在页面销毁时重新设置成关闭。

参考文档：<https://yoda.corp.kuaishou.com/docs/bridge/?kpn=KUAISHOU&namespace=webview&name=setSlideBack>

```js
const noBack = async (enabled: boolean) => {
    if (isOutLiveRoom) {
        await invoke('webview.setSlideBack', { enabled });
    }
};
noBack(false);

onUnmounted(() => {
    noBack(true);
});
```

---

### Q15：在部分 iOS 设备上，当使用 CSS 为元素设置 `margin-top` 属性为负值时，若负 margin 与某些特定的布局或动画相结合，可能会导致页面元素的不可见部分突然显示在视口中

- **记录人**：@周纤纤

**A**：避免使用负 margin。

如果需要上移元素，可以考虑使用 `position: absolute` 配合 `top` 属性，或者使用 `transform: translateY(-x)`（x 为负值），这样做可以避免 margin 引起的问题，因为这些属性不会导致布局的变化。

```css
/* 之前 */
margin-top: -10px;

/* 之后 */
transform: translateY(-10px);
```

> **注意**：底部可能会多出来空白区域。

---

### Q16：【ios】1px 的虚线转成 rem 后在部分 iOS 机型上不生效

- **记录人**：@张拓
- **项目**：24 年度盛典

**A**：经测试 1.06px 及以下宽度的虚线转 rem 后，在部分 iOS 机型上不生效。原因不详。

**解决方案**：

- **方案①**：保证虚线 px 足够大。（多大合适呢，暂不清楚）
- **方案②**：px 不转 rem。（宽度不还原，看 UI 老师能否接受）
- **方案③**：切图代替 border。（适用于 border 长度固定情况）

---

### Q17：【ios】gap 在 14.1 及以下不生效

- **记录人**：@王坤 @张拓
- **项目**：24 年度盛典

**A**：flex 布局避免使用 `gap`，使用 `margin` 配合伪类 `:not(:last-child)`、`:nth-child(odd)`。

**单行**：

```css
&:not(:last-child) {
  margin-right: 16px;
}
```

**双列**：

```css
.track-item {
    margin-bottom: 10px;
    &:nth-child(odd) {
        margin-right: 10px;
    }
}
```

---

### Q18：【半屏】【手势】profile 页打开半屏 H5 页面时，页面内手势与客户端冲突

- **记录人**：@郭钊
- **项目**：24 年度盛典

**问题详情**：H5 页面使用新版 P 页打开后，在页面内往左滑，会直接关闭 H5 页面，并调起直播间侧边栏。

**A**：去掉打开 H5 页面快链中的 `enablepandown=0` 参数。

---

### Q19：【ios】【输入框】iOS 输入框无法调整光标位置

- **记录人**：@郭钊
- **项目**：24 年度盛典

**A**：安卓正常，iOS 需要长按输入框中的任意位置，直到出现放大镜图标，这时你可以精确地移动光标到所需位置。【不是问题】

---

### Q20：【透明视频】安卓端播放透明视频偶现闪白

- **记录人**：@孙文新 @王宇飞
- **活动**：24 年度盛典

**A**：`@ks/tvplayer` 在销毁时会调用 `player?.destroy()` 释放 WebGL 上下文达到释放内存的目的，释放时会偶现安卓端闪白。推荐升级到 tvplayer 的 `2.3.0-alpha.1` 使用其提供的 context 复用功能。

---

### Q21：【字体样式】iOS 18 使用 `font-weight: bold` 占位比其他机型要宽

- **记录人**：@倪耿鸿
- **活动**：24 年度盛典

**A**：其他设备正常，iOS 18 变宽。这可能会导致字体在 iOS 18 的机器上异常换行。

---

### Q22：【canvas】部分机型 canvas 尺寸不继承父元素尺寸

- **记录人**：@程臻
- **活动**：24 年度盛典

**问题详情**：视频最后会转为 canvas 但尺寸不对。

**A**：需要给 canvas 设置 `width` 和 `height: 100%`，不然会按照屏幕宽度展示。

---

### Q23：【视频层级】部分机型视频和文字层级不正确

- **记录人**：@程臻
- **活动**：24 年度盛典

**A**：每个在视频上的元素都要给 `translate3d` 来框定层级，不然会影响展示甚至是功能（如 swiper）。
