# Issue tracker: Local Markdown

以下路径均相对项目根目录。

## Conventions

- 每项功能一个目录：`.scratch/<feature-slug>/`。
- 每张实现工单一个文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`。
- 从 01 开始，按依赖顺序编号，阻塞工单在前。
- 文件顶部使用 `**Status:**` 记录分诊状态，词汇见 [标签映射](triage-labels.md)。
- 使用 `**Blocked by:**` 列出阻塞工单的编号和标题；无阻塞时写 `None (can start immediately)`。
- `ready-for-agent` 表示描述充分；开始执行仍须等待所有阻塞工单完成。
- 评论追加到文件末尾的 `## Comments` 下。

## Specs

规格入口为 `.scratch/<feature-slug>/spec.md`。
已有权威规格时，入口文件只链接它，不复制正文。
当前 MVP 的权威规格是 `docs/mvp-spec.md`。

## Read and publish

- “发布到工单系统”表示创建对应的本地文件。
- “读取工单”表示读取指定文件；只有编号时，在对应功能目录查找。
- 发布实现工单时保持一票一文件，不合并成总工单文件。
