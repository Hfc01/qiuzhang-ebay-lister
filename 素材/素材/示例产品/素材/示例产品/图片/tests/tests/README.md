# 开发调试脚本

此目录存放开发阶段的探针/测试脚本，**日常使用不需要运行它们**。

| 文件 | 用途 |
|---|---|
| inspect.mjs | 检查编辑器 iframe 内部结构（只读） |
| open-and-probe.mjs | 打开页面并探测表格/编辑器结构 |
| probe-editor.mjs | 探测克隆编辑器单元格结构 |
| test-accounts.mjs | 测试账号下拉逐行分配 |
| test-title.mjs | 测试标题逐行填充 |
| test-rows.mjs / test-rows-b.mjs | 测试 JExcel 行操作 |
| test-upload.mjs | 测试图片上传与拖拽排序 |
| test-confirm.mjs | 测试图片弹窗「确定」提交 |

运行方式（需先启动调试浏览器并打开数字酋长页面）：

```
..\runtime\node.exe test-title.mjs
```
