# UTIL_README（角色编辑器技术文档 / 低 Token 导航）

> 适用范围：`Util/`（角色编辑器前后端）。
> 目标：帮助 AI Agent 在最少检索下完成角色编辑器相关开发与排障，减少 Search Agent token 消耗。

## 1. 先说结论（给 Agent 的最短路径）

1. 先看 `Util/server/index.js` 顶部路径常量，确认运行时读写根目录（`utilRoot / modRoot / gameRoot`）。
2. 再看 API 清单（本文件第 4 节）决定前端或后端改动范围。
3. 角色数据异常优先查：
   - 角色定义解析缓存是否失效；
   - sprite 映射是否存在；
   - portrait 文件路径是否可访问；
   - localisation 键是否存在。
4. 需要新增功能时，优先“复用现有 pipeline 函数 + 补 API”，不要重写整套解析器。

---

## 2. 项目定位与运行方式

- `Util/` 是本仓库的**角色编辑器工具子项目**（React + Vite + Node/Express）。
- 用途：按国家 TAG 浏览/编辑角色、trait、本地化、头像资源。

### 常用命令

```bash
cd Util
npm run dev          # 前端 + 后端并行
npm run dev:server   # 仅后端（5179）
npm run dev:web      # 仅前端（Vite 默认端口）
npm run build
npm run lint
```

---

## 3. 目录结构（仅列高价值路径）

```txt
Util/
  server/index.js        # 角色编辑器后端主服务（核心）
  src/App.jsx            # 前端单页主逻辑（核心）
  src/index.css          # 样式入口
  package.json           # 脚本与依赖
  .cache/sprite_index.json  # sprite 索引缓存（运行期生成）
```

> 低 token 规则：除非依赖问题，**不要扫描 `Util/node_modules/`**。

---

## 4. API 速查（后端契约）

后端入口：`Util/server/index.js`，监听 `5179`。

### 健康与元信息

- `GET /api/health`
- `GET /api/meta`
- `GET /api/tags`

### Trait 相关

- `GET /api/traits`
- `GET /api/traits/detail`
- `POST /api/traits/upsert`
- `POST /api/traits/:id/localization`

### Character 相关

- `GET /api/characters?tag=...`
- `GET /api/characters/:id?tag=...`
- `POST /api/characters`
- `POST /api/characters/:id/traits`
- `POST /api/characters/:id/localization`
- `POST /api/characters/:id/description-localization`

### Portrait 相关

- `POST /api/characters/:id/portrait/import`
  - 入参支持 `imageDataUrl` 或 `ddsBase64`。
- `GET /api/image?path=...`
  - 读取图片文件；DDS 自动尝试解码为 PNG 返回。

---

## 5. 后端核心架构（最需要理解）

## 5.1 路径与数据源

- `modRoot` 指向模组仓库根目录（用于读写 `common/`、`interface/`、`gfx/` 等）。
- `gameRoot` 指向本机 HOI4 目录（用于读取原版资源回退）。
- `traitReferences` 指向外部“基础代码提词器”文本，用于 trait 参考。

## 5.2 缓存层

服务含多类缓存：
- 角色定义缓存
- sprite 映射缓存
- localisation 缓存
- portrait 查找缓存
- recruit_character 索引缓存

修改角色、trait、portrait 后务必刷新相关缓存；否则前端会看到旧数据。

## 5.3 Portrait Pipeline

核心流程（`/api/characters/:id/portrait/import`）：
1. 定位角色 portrait 对应 sprite/texture 目标；
2. 写入图片（png/jpg/dds 输入）；
3. 必要时补写或重连 idea sprite；
4. 更新角色 small portrait 引用；
5. 失效 portrait 缓存并返回 `portraitUrl`。

`/api/image` 会按扩展名读取图片；若是 DDS，会尝试解码并返回 PNG，失败则回退 SVG 占位图。

---

## 6. 前端核心架构（`Util/src/App.jsx`）

前端是单页状态机，重点状态：
- 标签/角色加载：`selectedTag`、`characters`、`characterDetails`
- trait 编辑：`traitEditorText`、`traitDetails`、`selectedTraitId`
- 本地化编辑：角色名 + 描述草稿
- 肖像编辑：`portraitModalOpen`、缩放/偏移、导入状态

加载策略：
- 先并行加载 `meta/tags/traits`；
- 选中 TAG 后加载角色列表；
- 先取轻量角色详情，再异步补 portrait。

这意味着：列表流畅性优先，头像为延迟补齐。

---

## 7. 写入文件约定（避免误改）

角色编辑器通常会触及：
- `common/characters/*.txt`
- `common/country_leader/*.txt`
- `common/unit_leader_traits/*.txt`
- `interface/*.gfx`
- `localisation/*/*.yml`
- `gfx/leaders/**`、`gfx/interface/ideas/**`

建议：
1. 优先写入编辑器专用或增量文件；
2. 避免无关格式化导致大 diff；
3. 提交前检查是否混入缓存或依赖变更。

---

## 8. Agent 推荐工作流（低 Token）

1. **判定任务类型**：角色资料 / trait / 本地化 / 肖像。
2. **只读对应最小文件集**：
   - 后端任务：`Util/server/index.js`
   - 前端任务：`Util/src/App.jsx`
   - 运行问题：`Util/package.json` scripts
3. **定向搜索，不全扫**：
   - `rg "app\.(get|post)\(" Util/server/index.js`
   - `rg "portrait|trait|localization" Util/src/App.jsx`
4. **改动后最小验证**：
   - `npm run lint`（若环境允许）
   - 启动服务验证关键 API
5. **提交前检查**：
   - 确认仅提交目标文件，不包含 `node_modules/`、`.cache/`、临时产物。

---

## 9. 高频问题与排障优先级

1. **角色看不到/不刷新**
   - 先查缓存是否清理、`tag` 参数是否正确。
2. **trait 保存后 UI 无变化**
   - 查 trait upsert 写入位置 + localisation 同步。
3. **头像导入成功但不显示**
   - 查 spriteName 与 texturefile 是否匹配；
   - 查 `/api/image` path 是否在允许根路径下；
   - 查 DDS 解码是否回退到占位图。
4. **新增角色后未自动可招募**
   - 查 recruit_character 注入逻辑是否执行。

---

## 10. 给未来维护者的建议

- 把“解析 + 写入 + 缓存失效”保持在同一条调用链，不要分散到多个入口。
- 前端继续保持“列表轻量、详情按需”的加载模式，避免全量拉取 portrait。
- 如需新增复杂编辑能力（批量导入、多角色操作），优先扩展现有 API 而非新开并行体系。

