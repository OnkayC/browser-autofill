let parentPort: MessagePort | null = null;

export function connectIframeParentChannel(port: MessagePort): void {
  parentPort?.close();
  parentPort = port;
  parentPort.start();
}

export function postToIframeParent(message: unknown): void {
  parentPort?.postMessage(message);
}
