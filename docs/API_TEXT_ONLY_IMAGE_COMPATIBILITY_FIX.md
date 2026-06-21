# API 文本接口与图片附件兼容修复

## 问题

部分 OpenAI-compatible 接口只接受：

```json
{"role":"user","content":"纯文本"}
```

但图片附件原先会被构造成：

```json
{
  "role": "user",
  "content": [
    {"type":"text","text":"..."},
    {"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}
  ]
}
```

如果当前接口不支持多模态 `image_url`，会返回类似：

```text
unknown variant `image_url`, expected `text`
```

这不是 API Key / Base URL / 网络问题，而是消息格式不兼容。

## 修复

1. 前端请求构造层根据当前 provider/model 判断是否发送 `image_url`。
2. 非视觉模型默认改为纯文本模式，不发送 base64 图片块。
3. 图片仍保存本地、仍在问题卡片内预览，并在 prompt 里以文本说明图片附件信息。
4. 后端增加兜底：如果接口仍返回 `image_url` 不兼容错误，会自动把消息转成纯文本后重试一次。

## 保留能力

- 图片附件预览不变。
- 文档/代码/PDF/DOCX 解析链路不变。
- 视觉模型仍可发送 `image_url`。
- 非视觉模型不会再因为图片附件导致请求体反序列化失败。
