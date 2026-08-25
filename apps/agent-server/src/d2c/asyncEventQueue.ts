/** 将回调式进度安全转换为按顺序消费的异步迭代器。 */

/** 支持关闭、缓存和单消费者顺序读取的轻量异步事件队列。 */
export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  /** 追加一个事件；关闭后的迟到事件会被忽略。 */
  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  /** 关闭队列并唤醒全部等待者，已缓存事件仍会按顺序消费。 */
  close(): void {
    this.closed = true;
    if (this.values.length > 0) return;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /** 返回只支持顺序读取的异步迭代器。 */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}
