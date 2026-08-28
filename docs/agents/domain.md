# Domain Docs

## Layout

采用 single-context：根目录 `CONTEXT.md` 保存领域术语，
根目录 `docs/adr/` 保存架构决策。

## Before exploration

先读取 `CONTEXT.md`，再读取涉及当前工作范围的 ADR。
文档缺失时静默继续；术语或决策明确后，由 domain-modeling 按需记录。

## Vocabulary

工单标题、方案、测试名称使用术语表定义的词汇，
避免使用术语表明确排除的同义词。
确有术语缺口时交由 domain-modeling 补充。

## ADR conflicts

方案与既有 ADR 冲突时，明确指出决策编号和重新讨论的理由，
不默默覆盖既有决策。
