# ZotScholar

[English](./README.md) | [中文](./README_CN.md)

> 一款自动将 Zotero 文献库与 Semantic Scholar 保持同步的 Chrome 扩展。

ZotScholar 可将你的 Zotero 文献集合导入 Semantic Scholar（S2）Library，并保留文件夹结构，让 S2 能够为每个主题生成**每日论文推荐**。新增到 Zotero 的文献会在后台自动增量同步，无需手动操作。

---

## 安装

1. **下载**本仓库（点击 Code → Download ZIP，解压），或直接克隆：
   ```
   git clone https://github.com/qishenzhou/zotscholar.git
   ```
2. 打开 Chrome，访问 `chrome://extensions`
3. 开启右上角的**开发者模式**
4. 点击**加载已解压的扩展程序**，选择 `zotscholar` 文件夹
5. 工具栏出现 ZotScholar 图标，安装完成

---

## 配置

点击工具栏图标 → **⚙ 设置**，或右键图标 → **选项**，打开设置页面。

### 1. Zotero 凭据

| 字段 | 获取方式 |
|---|---|
| **Library ID** | [zotero.org](https://www.zotero.org/settings/security) → Account → Settings → Security → *"Your userID for API"* |
| **API Key** | 同一页面 → **Create new private key**（只读权限即可） |

填写后点击**测试**验证，再点击**保存设置**。

### 2. Semantic Scholar 登录

ZotScholar 直接读取你的 S2 浏览器会话，基础使用无需额外 API Key。  
请确保在同一个 Chrome 用户下已**登录 [semanticscholar.org](https://www.semanticscholar.org)**，设置页面会显示绿色指示灯表示已检测到登录状态。

### 3. S2 API Key（可选）

S2 API Key 可提升论文搜索的速率限制，加快大批量导入速度。  
前往 [S2 API 申请页](https://www.semanticscholar.org/product/api) 免费获取，填入设置页面的 **API Key** 字段。

---

## 功能介绍

### 一键导入文献集合
在插件弹窗的 Zotero 目录树中选择一个或多个集合，点击**开始导入**。  
ZotScholar 会通过 DOI、OpenAlex 或标题搜索将每篇文献匹配到对应的 S2 ID，并批量导入到同名 S2 文件夹。

每次导入结束后，结果卡片会显示三项统计：
- **在 S2 找到** — 成功添加的文献数
- **已同步** — 文件夹中已存在的文献（跳过）
- **未找到** — 无法在 S2 匹配的文献数

### 增量同步
重复导入已导入的集合时，只处理**上次同步后新增的文献**，已导入的文献会被瞬间跳过，无论集合大小同步速度都很快。

### 自动同步
在**设置 → 自动同步**中设置同步间隔（1 小时 / 6 小时 / 24 小时）。  
ZotScholar 会在后台静默检查所有已监听的集合，自动添加新文献，无需任何手动操作。也可点击**立即同步**手动触发。

### Research Feed（论文推荐）
导入成功后，点击**开启 Research Feed 并完成**，即可为该文件夹激活 S2 的每日论文推荐功能。也可在设置页面的监听集合列表中随时开关。

### 监听集合面板
设置页面列出所有曾经导入过的集合，针对每个集合可以：
- 查看文献数量和上次同步时间
- 通过滑动开关切换 **Research Feed** 的开启/关闭状态
- 点击**移除**停止监听（S2 文件夹及其文献不会被删除）
- 使用**识别现有文件夹**自动将 S2 中与 Zotero 集合同名的文件夹注册为监听——适用于安装 ZotScholar 之前已有 S2 文件夹的情况

---

## 工作原理

1. 通过 **Zotero Web API** 读取文献集合及论文（支持完整子文件夹展开）
2. 按 DOI → OpenAlex → S2 标题搜索的顺序逐级匹配每篇论文的 S2 ID
3. 为每个 Zotero 集合在 S2 Library 中创建同名文件夹，并通过 S2 内部 API 批量添加文献
4. 记录每个集合已同步的 Zotero Item Key，以支持后续增量导入
5. 使用 `chrome.alarms` 实现定时后台同步，不依赖持久化 Service Worker

---

## 贡献者

<a href="https://github.com/qishenzhou">
  <img src="https://images.weserv.nl/?url=github.com/qishenzhou.png&h=72&w=72&mask=circle&maxage=7d" title="qishenzhou" />
</a>
&nbsp;
<a href="https://github.com/BeinuoYang">
  <img src="https://images.weserv.nl/?url=github.com/BeinuoYang.png&h=72&w=72&mask=circle&maxage=7d" title="BeinuoYang" />
</a>

---

## 版本历史

| 版本 | 主要更新 |
|---|---|
| **2.0.0** | 增量自动同步、监听集合面板、Research Feed 开关、识别现有文件夹、设置页面 UI 重设计 |
| 1.5.1 | 更名为 ZotScholar，新图标，新增选项页 |
| 1.0.0 | 初始版本——手动一次性导入 |
