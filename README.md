# 英语听力练习

舒韫制作的静态英语听力练习网站，含 CET-4、CET-6、IELTS 各 60 篇原创材料，共 646 道题。男女声各有标准和约快 10% 两档，共 720 条录音。答题、判分和练习记录在浏览器中处理，交卷后可查看原文、解析和复听。

[体验正式网站](https://shuyun-english-listening.freebream1.chatgpt.site)

## 本地运行

下载或克隆仓库，在仓库根目录使用 Node.js 22 或更新版本运行：

```sh
node scripts/preview.mjs
```

打开 [http://127.0.0.1:4395](http://127.0.0.1:4395)。请使用支持 Ogg Opus 的浏览器，例如新版 Chrome、Edge、Firefox 或 [Safari 18.4 及以上](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)。站点入口、题库及音频都位于 `dist/`，可将整个目录发布到支持 HTTPS 的静态托管服务，资源采用相对路径。

```sh
node scripts/check-release.mjs
node scripts/check-library.mjs
node scripts/check-answer-aliases.mjs
```

## 来源与许可

仓库中的原创代码、文档和练习材料，以及合成录音中作者有权许可的部分，均使用 [MIT 许可证](LICENSE)。男女声录音由 [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) 生成，采用 `af_sarah` 与 `am_puck` 音色。上游模型使用 Apache-2.0 许可。公开源码采用通用男女声，角色素材在独立维护的正式站点上。

官方样题与历年资料由页面链接指向原站，相关权利归原权利人所有。© 2026 舒韫。
