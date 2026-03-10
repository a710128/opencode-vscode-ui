# opencode-vscode-ui 重构执行蓝图

本计划用于指导当前仓库的**结构性重构**，目标是降低超大文件带来的维护成本，同时**严格保证现有功能、行为和交互不发生任何变化**。

本次计划只覆盖当前仓库，不包含 `opencode/` 软链接目录；扫描、设计、实施、验证均应**跳过 `opencode/`**。

---

## 1. 背景

这个仓库已经持续开发较长时间，当前代码体量增长的主要问题**不是全库平均失控**，而是**高度集中在 panel / webview 主链路**。

当前主要热点文件：

- `src/panel/webview/index.tsx`：约 4114 行
- `src/panel/webview/styles.css`：约 2390 行
- `src/panel/provider.ts`：约 1360 行
- `PLAN.md`：约 605 行

其中真正需要优先处理的是前三个运行时代码文件；`PLAN.md` 只是文档体量较大，不是运行时风险源。

---

## 2. 重构目标

### 2.1 核心目标

1. 降低单文件复杂度
2. 让 host / bridge / webview 的职责边界更清晰
3. 保持后续功能迭代仍能沿现有架构平滑推进
4. 为后续主题定制、renderer 扩展、局部测试补充留出空间

### 2.2 最重要约束

本次重构必须满足以下约束：

1. **不改变任何现有功能**
2. **不改变任何现有交互行为**
3. **不改变任何现有视觉语义**
4. **不改变 bridge 协议语义**
5. **不改变 runtime、session、workspace 的既有职责划分**
6. **不把重构扩散成全仓库重写**

换言之，本次重构是一次**低风险结构整理**，不是功能升级，也不是架构推翻重来。

---

## 3. 范围

### 3.1 本次纳入范围

- `src/panel/webview/index.tsx`
- `src/panel/webview/styles.css`
- `src/panel/provider.ts`
- 与上述拆分直接相关的局部 import、导出、目录结构调整

### 3.2 本次不纳入范围

- `opencode/` 软链接目录
- `src/core/` 的大规模重构
- `src/sidebar/` 的大规模重构
- `src/bridge/types.ts` 的协议重设计
- 新功能开发
- 视觉风格重做
- upstream UI 的大规模复制
- 为了“顺手优化”而做的领域命名重写

说明：如果在重构过程中必须对少量类型、工具函数或 import 位置做配套调整，这类调整可以接受，但前提仍然是**行为不变**。

---

## 4. 重构策略

整体采用：**按现有边界做垂直拆分，先搬运，后收敛，最后再清理命名与重复逻辑**。

严禁以下做法：

- 一次性重写整个 webview
- 一次性改写 provider 的事件流模型
- 先抽象一层“完美框架”再迁移代码
- 在拆分同时引入新的 UI 方案或状态管理方案
- 在 CSS 拆分时顺手改主题表现、间距体系或状态色语义

建议顺序必须是：

1. **搬运拆分**：把现有代码按职责拆开，逻辑尽量原样迁移
2. **局部去重**：只抽已经稳定、明显重复的 helper
3. **轻度清理**：在验证稳定后再做命名和文件组织收口

---

## 5. 架构判断

### 5.1 现状判断

当前问题集中在 panel/webview 这条链路：

1. `index.tsx` 同时承担了：
   - app 根组件
   - host message 接收
   - timeline 构建
   - tool renderer 路由
   - markdown / diff / code 渲染
   - permission / question 底部阻塞区
   - session 状态与 composer 信息推导
   - 各类格式化与类型保护 helper

2. `styles.css` 同时承担了：
   - 全局基础样式
   - 布局
   - timeline
   - tool row / panel
   - output window
   - diff
   - markdown
   - syntax highlight
   - 状态色与语义色

3. `provider.ts` 同时承担了：
   - webview panel 生命周期
   - bootstrap / snapshot 装配
   - event reduce
   - message / part mutation
   - permission / question / MCP action
   - file open / resolveFileRefs
   - session navigation 相关逻辑

### 5.2 结论

最佳路径不是“全库一起整理”，而是先集中治理最重的 3 个热点文件，把 panel host 与 panel webview 的职责重新拉开。

---

## 6. 总体实施顺序

优先级如下：

### P0

- `src/panel/webview/index.tsx`

### P1

- `src/panel/webview/styles.css`
- 其中第一步先抽出 `theme.css`

### P2

- `src/panel/provider.ts`

### P3

- 文档和命名层面的补充收口

说明：CSS 虽然体量巨大，但因为它紧贴 webview 组件结构，实际应在 `index.tsx` 完成第一轮拆分后再做镜像拆分；而 `provider.ts` 需要建立在前两步没有引入行为回归的前提下进行。

---

## 7. Phase 1：拆分 src/panel/webview/index.tsx

### 7.0 当前进展

当前 Phase 1 已经开始执行，并且以下拆分已经完成：

- 薄入口已恢复：`src/panel/webview/index.tsx` 现在只负责挂载 `App` 和加载样式
- 主实现已迁入：`src/panel/webview/app/App.tsx`
- 状态归一化已拆出：`src/panel/webview/app/state.ts`
- 上下文已拆出：`src/panel/webview/app/contexts.ts`
- hooks 已拆出：`src/panel/webview/hooks/useHostMessages.ts`、`src/panel/webview/hooks/useTimelineScroll.ts`、`src/panel/webview/hooks/useComposer.ts`、`src/panel/webview/hooks/useModifierState.ts`
- Dock 相关组件已拆出：`src/panel/webview/app/docks.tsx`
- Timeline 相关组件和 helper 已拆出：`src/panel/webview/app/timeline.tsx`
- Part / Tool dispatch 已拆出：`src/panel/webview/app/part-views.tsx`
- Tool row / Task row / Tool spinner 已拆出：`src/panel/webview/app/tool-rows.tsx`
- 第一批 `Tool*Panel` 已拆出：`src/panel/webview/tools/ToolTextPanel.tsx`、`src/panel/webview/tools/ToolLspPanel.tsx`、`src/panel/webview/tools/ToolLinksPanel.tsx`、`src/panel/webview/tools/ToolFilesPanel.tsx`

当前新增文件清单：

- `src/panel/webview/app/App.tsx`
- `src/panel/webview/app/state.ts`
- `src/panel/webview/app/contexts.ts`
- `src/panel/webview/app/docks.tsx`
- `src/panel/webview/app/timeline.tsx`
- `src/panel/webview/app/part-views.tsx`
- `src/panel/webview/app/tool-rows.tsx`
- `src/panel/webview/app/tool-row-meta.tsx`
- `src/panel/webview/app/webview-bindings.tsx`
- `src/panel/webview/tools/types.ts`
- `src/panel/webview/tools/ToolTextPanel.tsx`
- `src/panel/webview/tools/ToolLspPanel.tsx`
- `src/panel/webview/tools/ToolLinksPanel.tsx`
- `src/panel/webview/tools/ToolFilesPanel.tsx`
- `src/panel/webview/tools/ToolWritePanel.tsx`
- `src/panel/webview/tools/ToolEditPanel.tsx`
- `src/panel/webview/tools/ToolApplyPatchPanel.tsx`
- `src/panel/webview/tools/ToolTodosPanel.tsx`
- `src/panel/webview/tools/ToolQuestionPanel.tsx`
- `src/panel/webview/renderers/CodeBlock.tsx`
- `src/panel/webview/renderers/DiffBlock.tsx`
- `src/panel/webview/renderers/OutputWindow.tsx`
- `src/panel/webview/renderers/FileRefText.tsx`
- `src/panel/webview/renderers/MarkdownBlock.tsx`
- `src/panel/webview/lib/part-utils.ts`
- `src/panel/webview/lib/tool-meta.ts`
- `src/panel/webview/lib/session-meta.ts`
- `src/panel/webview/hooks/useHostMessages.ts`
- `src/panel/webview/hooks/useTimelineScroll.ts`
- `src/panel/webview/hooks/useComposer.ts`
- `src/panel/webview/hooks/useModifierState.ts`

当前 `src/panel/webview/app/App.tsx` 的保留职责已经收口为：

- 顶层 state 组织与 bootstrap / snapshot 装配
- host message、scroll、modifier、composer hooks 调用
- permission / question / retry / session nav / composer 的主布局组装
- MCP status action 与 composer 状态展示

本轮新增收口：

- 已建立 `src/panel/webview/lib/` 第一轮 helper 收口，新增：`part-utils.ts`、`tool-meta.ts`、`session-meta.ts`
- `App.tsx` 中一批稳定纯函数已迁出，包括 path / guard / part meta / tool meta / patch summary / session status / composer metrics 相关 helper
- 已新增 `src/panel/webview/app/tool-row-meta.tsx`，把 tool row / task row 相关的 title、subtitle、summary、extras、task body 等行级 helper 从 `App.tsx` 继续迁出
- `ToolLspPanel` 的 inline title 生成 helper 已继续就近迁入 `src/panel/webview/tools/ToolLspPanel.tsx`，`App.tsx` 不再保留这块 LSP 特化标题逻辑
- 已新增 `src/panel/webview/app/webview-bindings.tsx`，把 tool / renderer / timeline 的 message-bound wrapper 与 `FileRefText`、`MarkdownBlock`、navigation 绑定统一搬出 `App.tsx`
- `composerIdentity`、`composerMetrics` 也已下沉到 `src/panel/webview/lib/session-meta.ts`

当前仍未完成的重点：

- Phase 1 的 webview 结构拆分目标已完成；当前剩余重点转为全链路人工回归与文档层收口

建议的后续连续执行顺序：

1. 走一次 panel / webview 主链路人工回归
2. 对照 `PLAN.md` 做最终文档状态收口
3. 如需继续轻量整理，只做低风险命名与局部 simplify

当前状态判断：

- `src/panel/webview/index.tsx` 的“薄入口”目标已达成
- `src/panel/webview/app/App.tsx` 已达到顶层 orchestration 为主的目标
- Phase 1、Phase 2、Phase 3 现已完成，运行时代码主拆分目标已达成

已完成拆分阶段均已重复通过：

- `bun run check-types`
- `bun run lint`
- `bun run compile`

### 7.1 目标

把当前 4000+ 行的 webview 入口拆成多个职责单一的模块，但**不改变现有 UI 渲染结果和交互路径**。

### 7.2 拆分原则

1. `App` 只保留应用级状态拼装和主布局
2. hooks 只负责状态同步、监听、滚动、输入等行为逻辑
3. timeline 相关组件独立目录
4. tool renderer 独立目录
5. markdown / diff / code / path / format helper 独立目录
6. Dock 区块与时间线区块分离
7. 保持原有 className 不变，避免 CSS 风险扩大

### 7.3 建议目录

```txt
src/panel/webview/
  index.tsx
  theme.css
  base.css
  layout.css
  timeline.css
  tool.css
  dock.css
  markdown.css
  diff.css
  status.css
  app/
    App.tsx
    initial-state.ts
  hooks/
    useHostMessages.ts
    useTimelineScroll.ts
    useComposer.ts
    useModifierState.ts
  timeline/
    Timeline.tsx
    TimelineBlockView.tsx
    PartView.tsx
    DividerPartView.tsx
    AssistantTurnMeta.tsx
  docks/
    PermissionDock.tsx
    QuestionDock.tsx
    SessionNav.tsx
    SubagentNotice.tsx
  tools/
    ToolRow.tsx
    ToolPartView.tsx
    TaskToolRow.tsx
    ToolTextPanel.tsx
    ToolLspPanel.tsx
    ToolShellPanel.tsx
    ToolLinksPanel.tsx
    ToolFilesPanel.tsx
    ToolWritePanel.tsx
    ToolEditPanel.tsx
    ToolApplyPatchPanel.tsx
    ToolTodosPanel.tsx
    ToolQuestionPanel.tsx
    tool-registry.ts
  renderers/
    MarkdownBlock.tsx
    CodeBlock.tsx
    DiffBlock.tsx
    OutputWindow.tsx
    FileRefText.tsx
  lib/
    timeline.ts
    tools.ts
    diff.ts
    markdown.ts
    paths.ts
    format.ts
    guards.ts
    questions.ts
    composer.ts
```

说明：这是**推荐落点**，不要求一步到位完全长成，但拆分方向应保持一致，避免拆完后仍然回到一个“新的大文件”。

### 7.4 组件与逻辑拆分建议

#### A. App 层

保留在 `App.tsx`：

- 根 state 组织
- bootstrap + snapshot 的组合
- 顶层布局
- `Timeline`、Composer、Dock、Nav 等区块组装

移出 `App.tsx`：

- `window.message` 监听
- 自动滚动逻辑
- textarea resize 逻辑
- modifier key body class 同步
- 各类格式化 helper

当前状态：

- 顶层布局、bootstrap/snapshot 组合、Dock/Timeline/Composer 组装仍保留在 `App.tsx`
- host message、滚动、composer resize、modifier key 已移出
- `App.tsx` 仍承载大部分 tool panel、renderer 与纯 helper，尚未收口完成

#### B. hooks 层

建议拆出：

- `useHostMessages.ts`
  - 接收 `bootstrap`
  - 接收 `snapshot`
  - 接收 `error`
  - 接收 `fileRefsResolved`
  - 接收 `mcpActionFinished`

- `useTimelineScroll.ts`
  - stick-to-bottom
  - near-bottom threshold
  - 滚动监听
  - 新消息后自动贴底

- `useComposer.ts`
  - draft 管理
  - auto resize
  - submit 前置判断

- `useModifierState.ts`
  - `metaKey / ctrlKey` 状态同步到 `body`

当前状态：**已完成**

#### C. timeline 层

建议承接：

- `Timeline`
- `TimelineBlockView`
- `PartView`
- `DividerPartView`
- assistant meta 渲染
- turn 级别组合逻辑

相关 helper 建议从页面组件中抽走：

- `buildTimelineBlocks`
- `lastPendingAssistantIndex`
- `primaryUserText`
- `userAttachments`
- `visibleAssistantPart`
- `assistantSummary`
- `assistantTurnMeta`
- `lastStepFinish`

当前状态：**第一轮已完成**。`Timeline`、assistant meta、timeline block 构建、queued user block 判定、user attachment 相关 helper、assistant part visibility 相关 helper 已迁入 `src/panel/webview/app/timeline.tsx`。后续仍可继续按 `timeline/` 目录目标细化拆分。

#### D. tools 层

建议把当前大量 tool 逻辑拆成“路由 + 面板”：

- 入口：`ToolPartView` / `tool-registry.ts`
- 行级摘要：`ToolRow`
- 特殊任务：`TaskToolRow`
- 各类 panel：bash / files / write / edit / patch / lsp / todos / question 等

建议抽出的 helper：

- `toolLabel`
- `defaultToolTitle`
- `defaultToolSubtitle`
- `defaultToolArgs`
- `toolTextBody`
- `toolRowTitle`
- `toolRowSubtitle`
- `toolRowSummary`
- `toolRowExtras`
- `taskSummary`
- `taskBody`
- `toolWriteContent`
- `toolEditDiff`
- `patchFiles`
- `toolDiagnostics`

当前状态：**Phase 1 已完成**。`ToolPartView`、`ToolRow`、`TaskToolRow`、`ToolStatus` 已迁出；两批 `Tool*Panel` 已迁入 `src/panel/webview/tools/`；`toolDetails`、`toolTextBody`、`toolDiagnostics`、`toolFiles`、`defaultToolExpanded` 等稳定 helper 已收拢到 `src/panel/webview/lib/tool-meta.ts`；行级的 `toolRowTitle`、`toolRowSubtitle`、`toolRowSummary`、`toolRowExtras`、`taskBody` 等 helper 已迁入 `src/panel/webview/app/tool-row-meta.tsx`；LSP inline title helper 已就近迁入 `src/panel/webview/tools/ToolLspPanel.tsx`；tool / renderer / timeline 的 message-bound wrapper 已集中到 `src/panel/webview/app/webview-bindings.tsx`，`App.tsx` 现已主要保留顶层 orchestration。

#### E. renderers 层

建议独立：

- markdown 渲染
- code window 渲染
- unified / split diff 渲染
- output window
- 文件引用渲染

相关 helper 建议集中：

- `renderMarkdownCodeWindow`
- `highlightCode`
- `parseUnifiedDiffRows`
- `parseDiffHunks`
- `splitDiffRows`
- `outputWindowBodyHeight`
- `parseFileReference`
- `normalizeFileReference`
- `syncMarkdownFileRefs`

当前状态：**Phase 1 已完成**。`MarkdownBlock`、`CodeBlock`、`DiffBlock`、`OutputWindow`、`FileRefText` 已迁入 `src/panel/webview/renderers/`；原先留在 `App.tsx` 的薄包装接线已进一步集中到 `src/panel/webview/app/webview-bindings.tsx`，不再占用顶层 `App.tsx`。

当前待迁出的大块：

- markdown code window / diff 解析 / output window 高度计算等 helper 已随 renderer 一起迁移
- 后续仍可继续评估哪些 renderer helper 适合进一步下沉到 `lib/`

#### F. lib 层

统一收拢无 UI 状态的纯函数：

- path 处理
- text / number / record guard
- diff 统计
- 时间与 duration 格式化
- provider / model / tokens / cost 推导
- question form answer key 组装

当前状态：**Phase 1 已完成**。当前已新增 `src/panel/webview/lib/part-utils.ts`、`src/panel/webview/lib/tool-meta.ts`、`src/panel/webview/lib/session-meta.ts`，并完成 path / guard / tool meta / session status / composer metrics 等稳定纯函数的第一轮收口，满足 `App.tsx` 收口所需。

### 7.5 迁移步骤

建议按以下顺序迁移：

1. 先抽纯 helper 到 `lib/`
2. 再抽 render-only 组件到 `renderers/`、`docks/`、`timeline/`
3. 再抽 tool panel 到 `tools/`
4. 最后收敛 `App.tsx` 和 hooks
5. 保留一个很薄的 `index.tsx` 只负责入口挂载

当前执行位置：

- 第 5 步已完成
- 第 4 步已完成
- 第 2 步和第 3 步已完成
- 第 1 步已完成第一轮 helper 收口并支撑 Phase 1 收口

更细的当前落点：

- 入口拆薄完成
- hooks 拆分完成
- docks 拆分完成
- timeline 第一轮拆分完成
- part/tool dispatch 第一轮拆分完成
- tool rows 第一轮拆分完成
- 第一批 tool panels 拆分已完成
- 第二批 tool panels 拆分已完成
- renderers 第一轮拆分已完成
- helper 向 `lib/` 收拢已完成第一轮
- `App.tsx` 顶层收口完成，Phase 2 可以开始

### 7.6 本阶段验收

必须全部满足：

1. 页面视觉结果与当前一致
2. Timeline 阅读流、折叠行为、active tool 强调、completed tool 弱化保持一致
3. Composer 行为、排队行为、running indicator、provider/model/agent 显示保持一致
4. Permission / Question 底部阻塞区行为保持一致
5. Child session / Parent / Prev / Next 导航保持一致
6. File ref resolve、open file、MCP action 行为保持一致
7. 不引入新的状态源和新的交互入口

---

## 8. Phase 2：拆分 src/panel/webview/styles.css

### 8.0 当前进展

当前 Phase 2 已完成，且已落地以下拆分：

- 已建立 `src/panel/webview/theme.css`，集中承接 webview 的颜色 token、背景 / 前景 token、border token、hover / active token、状态色 token，以及 markdown / code / diff 语义色
- 已删除原 `src/panel/webview/styles.css`，并改由 `src/panel/webview/index.tsx` 顺序加载拆分后的样式文件，保持原有级联顺序稳定
- 已完成样式镜像拆分：`src/panel/webview/base.css`、`src/panel/webview/layout.css`、`src/panel/webview/timeline.css`、`src/panel/webview/tool.css`、`src/panel/webview/dock.css`、`src/panel/webview/markdown.css`、`src/panel/webview/diff.css`、`src/panel/webview/status.css`
- 组件样式文件中的硬编码颜色已继续收敛，拆分后残留的颜色字面量已集中在 `theme.css`
- 拆分过程中保持了原有 className、视觉语义、hover / badge / status 语义与交互结构不变

当前状态判断：

- `theme.css` 已成为统一 token 层
- 其他 CSS 文件已主要只消费 `var(--oc-...)`
- Phase 2 现已完成，并已为后续 Phase 3 拆分提供稳定前提；当前三阶段运行时代码拆分已全部完成

本阶段已验证通过：

- `bun run check-types`
- `bun run lint`
- `bun run compile`

### 8.1 目标

把当前样式按职责拆开，同时建立**单独的主题层**，为后续不同 theme 定制打基础。

### 8.2 主题层要求

必须单独拆出：

- `src/panel/webview/theme.css`

这个文件用于集中保存：

- 颜色 token
- 背景 / 前景 token
- border token
- hover / active token
- 状态色 token
- markdown / code / diff 的语义色
- 需要主题化的阴影、圆角、可选 spacing token

原则：

1. **颜色值优先全部收敛到 `theme.css`**
2. 其他 CSS 文件尽量只消费 `var(--oc-...)`
3. `theme.css` 先提供当前默认主题
4. 后续如需扩展，可在同层继续增加 `theme-dark.css`、`theme-light.css` 或等价方案

### 8.3 建议 CSS 文件拆分

```txt
src/panel/webview/
  theme.css
  base.css
  layout.css
  timeline.css
  tool.css
  dock.css
  markdown.css
  diff.css
  status.css
```

### 8.4 各文件职责

#### `theme.css`

负责：

- 主题变量
- 颜色与语义 token
- 组件公用视觉变量

禁止：

- 放具体组件结构样式
- 放大段布局定义

#### `base.css`

负责：

- reset / base typography
- body / root 基础规则
- 通用按钮、输入框基础规则

#### `layout.css`

负责：

- page shell
- 主区域布局
- timeline / dock / composer 的主栅格和间距

#### `timeline.css`

负责：

- turn block
- user / assistant lane
- divider
- timeline meta

#### `tool.css`

负责：

- tool row
- tool panel
- tool 状态表现
- output window 的非 diff 部分

#### `dock.css`

负责：

- permission dock
- question dock
- 底部阻塞区及相关表单

#### `markdown.css`

负责：

- markdown 内容样式
- inline code
- code window 中的 markdown 相关规则

#### `diff.css`

负责：

- unified diff
- split diff
- diff gutter
- diff 行状态颜色映射

#### `status.css`

负责：

- badge
- MCP / LSP / session running / retry 等状态展示
- popover 的状态色样式

### 8.5 拆分约束

1. 先抽 `theme.css`
2. 然后按现有 className 镜像拆分，避免边拆边重命名 class
3. 不在拆分时改变任何 spacing、contrast、hover、badge 语义
4. 不在拆分时顺手做视觉优化
5. 不把主题 token 和结构样式重新耦合回去

### 8.6 本阶段验收

必须全部满足：

1. 视觉结果与拆分前一致
2. 所有颜色、状态色、语义色都有稳定 token 来源
3. 组件样式文件内不再散落大量硬编码颜色
4. 后续新增主题时，不需要回头大量修改组件文件

---

## 9. Phase 3：拆分 src/panel/provider.ts

### 9.0 当前进展

当前 Phase 3 已完成，且已落地以下拆分：

- 原 `src/panel/provider.ts` 已收口为目录化结构：`src/panel/provider/index.ts`
- 已新增 `src/panel/provider/controller.ts`，集中承接 `SessionPanelController`、panel 生命周期、webview message 分发、ready / refresh / active 协调
- 已新增 `src/panel/provider/snapshot.ts`，集中承接 snapshot 主流程、bootstrap 装配、runtime fallback payload、provider / mcp / lsp 归一化与 summary / patch 逻辑
- 已新增 `src/panel/provider/reducer.ts`，集中承接 `reduce(payload, event)`、`needsRefresh(event, payload)` 与增量 agent mode 推导
- 已新增 `src/panel/provider/mutations.ts`，集中承接 message / part / permission / question 的 upsert、remove、delta 和排序纯逻辑
- 已新增 `src/panel/provider/navigation.ts`，集中承接 related session 收集、child session map、parent / prev / next navigation 与 request 排序逻辑
- 已新增 `src/panel/provider/actions.ts`，集中承接 submit、permission reply、question reply / reject、MCP connect / disconnect / reconnect
- 已新增 `src/panel/provider/files.ts`，集中承接 open file、resolve file uri、resolve file refs 与 file path -> uri 转换
- 已新增 `src/panel/provider/utils.ts`，集中承接 panel key / title / icon、bootstrap shape、text / wait 等无状态 helper

当前状态判断：

- `src/panel/provider/index.ts` 已收口为 manager 入口
- `src/panel/provider/controller.ts` 已收口为 host orchestration 主体
- Snapshot payload、HostMessage / WebviewMessage 语义、event reduce 路径保持不变
- Phase 3 现已完成，下一阶段应转到文档和命名层面的补充收口，以及全链路人工回归确认

本阶段已验证通过：

- `bun run check-types`
- `bun run lint`
- `bun run compile`

### 9.1 目标

把 panel host 侧逻辑按职责拆分，但不改变现有消息流、快照结构和事件归并结果。

### 9.2 当前职责分布问题

`provider.ts` 当前同时处理：

- panel 生命周期
- webview 消息接收
- snapshot 拉取
- bootstrap 构造
- event reduce
- message / part 增量更新
- permission / question 回复
- MCP connect / disconnect / reconnect
- open file / resolve file refs
- related session / navigation 推导

### 9.3 建议目录

```txt
src/panel/provider/
  index.ts
  controller.ts
  snapshot.ts
  reducer.ts
  mutations.ts
  actions.ts
  navigation.ts
  files.ts
  utils.ts
```

### 9.4 职责拆分建议

#### `controller.ts`

负责：

- `SessionPanelController`
- panel 创建 / reveal / dispose
- `onDidReceiveMessage` 分发
- ready / refresh / active state 协调

#### `snapshot.ts`

负责：

- `snapshot()` 主流程
- bootstrap 数据装配
- runtime 不可用 / loading / error 的各类默认 payload
- provider / mcp / lsp 等列表归一化

#### `reducer.ts`

负责：

- `reduce(payload, event)`
- `needsRefresh(event, payload)`
- patch / summary 相关纯逻辑

#### `mutations.ts`

负责：

- `upsertMessage`
- `upsertPart`
- `removePart`
- `appendDelta`
- `sortMessages`
- `sortParts`
- permission / question 的 upsert / filter / sort

#### `navigation.ts`

负责：

- `collectRelatedSessionIds`
- `relatedSessionMap`
- `nav`
- `ref`
- `agentMode` 相关推导

#### `actions.ts`

负责：

- `submit`
- `replyPermission`
- `replyQuestion`
- `rejectQuestion`
- `toggleMcp`

#### `files.ts`

负责：

- `openFile`
- `resolveFileUri`
- `resolveFileRefs`
- `toFileUri`

#### `utils.ts`

负责：

- `panelKey`
- `panelTitle`
- `panelIconPath`
- `wait`
- `text`
- `textError`
- 其他无状态 helper

### 9.5 迁移步骤

建议顺序：

1. 先抽纯函数：`utils.ts`、`mutations.ts`、`navigation.ts`
2. 再抽 `reducer.ts`
3. 再抽 `snapshot.ts`
4. 最后抽 `actions.ts` 与 `files.ts`
5. `controller.ts` 最后收口，保留最少 orchestration 逻辑

### 9.6 本阶段验收

必须全部满足：

1. Snapshot payload 结构不变
2. HostMessage / WebviewMessage 语义不变
3. Event 归并结果不变
4. submit、permission、question、MCP、openFile、resolveFileRefs 行为不变
5. panel title、panel restore、active panel 跟踪行为不变

---

## 10. 验证与回归要求

每一阶段都必须单独验证，不能等全部拆完后再一起看结果。

### 10.1 必跑命令

在每一个可提交阶段后，优先执行：

```bash
bun run check-types && bun run lint && bun run compile
```

当前测试命令仍为：

```bash
bun run test
```

但当前仓库没有真正测试用例，因此该命令只作为辅助确认，不替代类型、lint 与构建验证。

### 10.2 必查项目

每个阶段至少要人工确认以下内容：

#### webview 主流程

- 打开 session
- restore session panel
- timeline 渲染
- submit prompt
- streaming / 增量更新
- queued user block
- active tool / completed tool 展示

#### 底部交互

- permission reply
- question answer / reject
- todo 展示

#### 导航与子任务

- child session 展示
- task 与 child session 的关联入口
- Parent / Prev / Next 按钮

#### 状态与辅助能力

- composer 运行状态
- provider / model / agent 显示
- MCP 状态与动作
- LSP 状态
- file ref resolve
- open file

#### 样式一致性

- markdown
- code block
- diff block
- badge
- popover
- hover / selected / running / error 语义

### 10.3 回归原则

如果某一阶段引入行为差异，应优先回退该阶段的抽象，而不是继续在错误结构上叠补丁。

---

## 11. 迁移执行清单

### 11.1 执行顺序总表

1. 重构 `index.tsx`
2. 在 CSS 中先抽 `theme.css`
3. 再拆其他 CSS 文件
4. 重构 `provider.ts`
5. 做一次全链路回归验证

### 11.2 index.tsx 细化清单

1. 抽纯 helper 到 `lib/` - 已完成并满足 Phase 1 需要
2. 抽 markdown / diff / output / file refs 到 `renderers/` - 已完成
3. 抽 permission / question / nav / subagent notice 到 `docks/` - 已完成第一轮
4. 抽 timeline 组件到 `timeline/` - 已完成第一轮
5. 抽 tool row 和各 tool panel 到 `tools/` - 已完成两轮并补充 row helper 收口
6. 抽 host message、scroll、composer、modifier hooks - 已完成
7. 收口 `App.tsx` - 已完成
8. 保留薄入口 `index.tsx` - 已完成

当前建议接续执行清单：

1. 进入总体收尾阶段，补文档和命名层面的轻度收口
2. 做一次 panel / webview 主链路的全链路人工回归
3. 如无回归，再评估是否需要做额外的局部 simplify

### 11.3 CSS 细化清单

1. 先建立 `theme.css` - 已完成
2. 抽所有颜色、语义色、状态色为变量 - 已完成
3. 确保其他样式文件只消费变量 - 已完成
4. 再按 layout / timeline / tool / dock / markdown / diff / status 拆分 - 已完成
5. 做视觉一致性回归 - 已完成基础静态验证，下一阶段继续做全链路回归

### 11.4 provider.ts 细化清单

1. 抽 `utils.ts` - 已完成
2. 抽 `mutations.ts` - 已完成
3. 抽 `navigation.ts` - 已完成
4. 抽 `reducer.ts` - 已完成
5. 抽 `snapshot.ts` - 已完成
6. 抽 `actions.ts` - 已完成
7. 抽 `files.ts` - 已完成
8. 收口 `controller.ts` 与 `index.ts` - 已完成

---

## 12. 风险与控制

### 12.1 最大风险

#### A. 拆分时顺手改变行为

这是本次重构最大的风险。

控制方式：

- 迁移时优先复制逻辑，不先改写逻辑
- 每拆一层都做局部回归

#### B. CSS 拆分时顺手改视觉

控制方式：

- className 不变
- 主题 token 先映射当前颜色，不先追求更漂亮

#### C. provider 抽象过度

控制方式：

- 只按现有职责切文件
- 不引入新的事件模型和状态模型

#### D. 边界继续模糊

控制方式：

- UI 纯渲染逻辑、host orchestration、纯函数 helper 必须分开

---

## 13. 完成标准

当以下条件全部满足时，本轮重构才算完成：

1. `src/panel/webview/index.tsx` 不再承载绝大多数业务实现
2. `src/panel/webview/styles.css` 已拆分，并且存在独立 `theme.css`
3. `src/panel/provider.ts` 的核心职责已按模块拆开
4. 所有现有功能和交互保持不变
5. `bun run check-types && bun run lint && bun run compile` 通过
6. 没有把改动扩散到 `opencode/`、`src/core/`、`src/sidebar/` 的无关区域

---

## 14. 最终原则

本轮工作的本质是：

**在不改变用户感知结果的前提下，把已经跑通的 panel / webview 主链路重新整理成可长期维护的结构。**

优先保证：

1. 稳定性
2. 可读性
3. 局部可维护性
4. 后续扩展空间

而不是追求“看起来更高级”的一次性重构。

后续所有相关改动都应以本蓝图为准。
