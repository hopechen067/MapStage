# 安装 skill

`git clone` 拉的是整个项目；agent skill 只是其中的 `mapstage/` 目录（`SKILL.md` + `references/` + 运行时）。agent 不会从 clone 里自动发现它，要装进 agent 的 skills 目录。

## 一行安装

```bash
npx skills add hopechen067/MapStage --skill mapstage -g
```

或者用 GitHub CLI：

```bash
gh skill install hopechen067/MapStage mapstage --scope user
```

Windows 上如果建不了符号链接，给 `npx` 加 `--copy`。装完重载 skills。

## 让 agent 自己装

把这段话发给 agent：

```text
安装 MapStage skill：https://github.com/hopechen067/MapStage
用 npx skills add hopechen067/MapStage --skill mapstage -g 安装，装完重载 skills，然后告诉我 /mapstage 能做什么。
```

## 手动安装

把 `mapstage/` 复制到对应目录：

| Agent | 目录 |
|---|---|
| Claude Code | `~/.claude/skills/mapstage/` |
| Codex / OpenAI agents | `~/.codex/skills/mapstage/`（元数据见 `agents/openai.yaml`） |
| Grok CLI | `~/.grok/skills/mapstage/` |
| Cursor | 项目内 `.cursor/skills/mapstage/` |

> **只装在一个 agent 下会断。** 之前 MapStage 只装在 `.grok/skills`，换 Claude Code 就找不到。多个 agent 都要用时，每个目录各装一份，或用 `npx skills` 统一管理。

## 调用

```text
/mapstage 做一个河西走廊从武威到敦煌的路线移动
/mapstage 用墨色山水皮肤出一张全国定位图，台湾海南完整
/mapstage 把 story.json 的第 3 段镜头改成先总览再推到张掖
```

## 验证

```bash
cd mapstage/tuner && node verify.mjs
```

末尾输出 `verify ok` 即可。它检查必需文件、跑单测、并确认所有文本文件是干净的 UTF-8（仓库大量中文，曾两次被 GBK 存坏）。

## 瓦片

默认只用公开演示瓦片：OpenFreeMap 矢量、Mapterhorn 地形、EOX Sentinel-2 卫星（可选）。要换源，复制 `tuner/map-tiles.config.example.js` 为 `map-tiles.config.local.js`（已 gitignore，不要提交私人瓦片地址）。只用你有权使用的瓦片。
