# AI_README（给 AI Agent 的低 Token 导航）

> 目标：让 AI Agent 在最少检索下快速理解本仓库，避免全仓扫描，降低 token 消耗。

## 1. 仓库是什么

- 这是一个 **Hearts of Iron IV（钢铁雄心4）模组仓库**，模组名 `Plentiful World`。
- 仓库包含两类内容：
  1. **游戏模组内容本体**（`common/`、`events/`、`history/`、`interface/`、`localisation/`、`gfx/`、`map/`）
  2. **本地编辑器工具**（`Util/` 角色编辑器，`UtilTech/` 科技/装备编辑器）

## 2. 最高优先级文件（先看这些）

1. `descriptor.mod`
   - 定义模组元信息与大量 `replace_path`（表示覆盖原版对应目录）。
   - 这决定了“原版是否仍生效”的判断基线。
2. `README.txt`
   - 提供基础目录说明（简版）。
3. `document/科技树开发指南.md`
   - 科技改动的标准流程与常见错误定位（强烈建议先看）。
4. `document/已实现科技.md`
   - 当前已落地科技的范围与关键文件索引。
5. `document/集成式角色编辑器扩展技术方案.md`
   - 角色编辑器后续设计目标与接口规划。

## 3. 目录速查（按改动类型定位）

### A. 游戏逻辑（脚本）

- `common/`
  - `technologies/`：科技定义
  - `units/equipment/`：装备定义
  - `national_focus/`：国策树
  - `characters/`：角色定义
  - `country_leader/` / `unit_leader_traits/`：角色/将领特质
  - `on_actions/`：启动与自动触发逻辑
  - `country_tags/`、`bookmarks/`：国家标签与开局书签
- `events/`：事件脚本
- `history/countries/`：国家开局历史（科技、角色、OOB等）

### B. 显示与文本

- `interface/`：GUI 布局与 `.gfx` 资源映射
- `gfx/`：图片资源（头像、图标、旗帜等）
- `localisation/english`、`localisation/simp_chinese`：本地化文本

### C. 工具链

- `process_characters.py`
  - 从 `characters.json` 生成 CHI 角色/特质/GFX 输出文件。
- `Util/`
  - 角色编辑器（React + Node/Express）
- `UtilTech/`
  - 科技与装备编辑器（React + Node/Express）

## 4. 已知项目特点（避免误判）

1. **大面积 replace_path**
   - 若发现“原版行为不生效”，先检查是否被 `descriptor.mod` 覆盖。
2. **科技是多文件联动**
   - 技术定义、GUI grid、图标映射、本地化、开局科技必须同步。
3. **CHI 是核心样例国家**
   - 很多新增内容先在 CHI 链路实现，可优先参考 CHI 文件。
4. **部分内容由脚本/工具生成**
   - 看到 `zz_*_generated`、`CHI_extra.*` 等时，先确认其生成来源再手改。

## 5. AI Agent 推荐工作流（低 token）

1. **先判定改动域**（科技 / 角色 / 事件 / 国策 / 本地化 / 工具）。
2. **只读对应索引文件**：
   - 科技：先读 `document/科技树开发指南.md` + `document/已实现科技.md`
   - 角色：先读 `process_characters.py` + `document/集成式角色编辑器扩展技术方案.md`
3. **只检索相关目录**（禁止全仓深扫）：
   - 用 `rg --files <dir>` + `rg <keyword> <dir>` 定向查找。
4. **改动前确认是否生成文件**：
   - 若由脚本生成，优先改数据源或生成脚本，而不是直接改产物。
5. **提交前最小验证**：
   - 语法/结构检查 + 受影响文件一致性检查（ID、引用、路径）。

## 6. 快速任务路由

- “新增/修改科技”
  - 关注：`common/technologies`、`interface/*techtree*`、`interface/*.gfx`、`localisation/*`、`history/countries/*`
- “新增/修改角色”
  - 关注：`characters.json`、`process_characters.py`、`common/characters`、`common/*traits*`、`interface/*.gfx`
- “修改国策/事件联动”
  - 关注：`common/national_focus`、`events`、`history/countries`、`common/on_actions`
- “编辑器功能变更”
  - 关注：`Util/server` + `Util/src` 或 `UtilTech/server` + `UtilTech/src`

## 7. 注意事项（重要）

1. 非必要不要扫 `node_modules/`。
2. 非必要不要全量读取 `history/states/`（文件很多，token 开销大）。
3. 修改 tech/equipment ID 时，必须同步本地化键和引用位置。
4. 修改角色 portrait/trait 时，检查 `.gfx` 与角色定义是否一致。
5. 提交时尽量保持“单主题改动”，避免把工具缓存或依赖变动混入提交。

## 8. 建议的检索命令（示例）

```bash
# 定位目录内文件
rg --files common/technologies

# 定位某个 tech id 的全部引用
rg "pw_infantry_weapons1" common interface localisation history

# 定位角色生成链路
rg "CHI_extra|process_characters|characters.json" .
```

## 9. 一句话结论

- 这个仓库的高效策略是：**先看索引文档与入口脚本，再做目录级定向检索，避免全仓搜索**。
