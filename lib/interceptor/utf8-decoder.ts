/**
 * 持久化流式 UTF-8 解码器
 * 持有同一个 TextDecoder('utf-8') 实例，使用 { stream: true } 消除多字节汉字跨包截断导致的 \uFFFD 乱码
 */
export class StreamingUtf8Decoder {
  private decoder: TextDecoder;

  constructor() {
    this.decoder = new TextDecoder('utf-8', { fatal: false });
  }

  /**
   * 流式解码 chunk 数据，跨包保留多字节未决字节
   */
  public decode(chunk: Uint8Array): string {
    return this.decoder.decode(chunk, { stream: true });
  }

  /**
   * 流结束时 flush 缓冲区剩余字符
   */
  public flush(): string {
    return this.decoder.decode();
  }
}
