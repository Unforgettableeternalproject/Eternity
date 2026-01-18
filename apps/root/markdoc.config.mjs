import { defineMarkdocConfig, component } from '@astrojs/markdoc/config';

export default defineMarkdocConfig({
  tags: {
    // 支援自訂 tag（如果未來需要）
  },
  nodes: {
    // 自訂圖片渲染
    image: {
      render: component('./src/components/MarkdocImage.astro'),
      attributes: {
        src: { type: String, required: true },
        alt: { type: String },
        title: { type: String },
        width: { type: Number },
        height: { type: Number },
      },
    },
  },
});
