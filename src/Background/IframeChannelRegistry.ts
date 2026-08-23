import browser from "webextension-polyfill";

interface PendingIframeChannel {
  tabId: number;
  expiresAt: number;
}

const channelLifetimeMs = 30_000;
const maximumPendingChannels = 100;

export class IframeChannelRegistry {
  private static pendingChannels = new Map<string, PendingIframeChannel>();

  static register(
    token: string,
    sender: browser.Runtime.MessageSender,
  ): boolean {
    const tabId = sender.tab?.id;
    if (
      tabId === undefined ||
      !this.isWebContentScript(sender) ||
      !this.isValidToken(token)
    ) {
      return false;
    }

    this.prune();
    if (this.pendingChannels.size >= maximumPendingChannels) {
      const oldestToken = this.pendingChannels.keys().next().value;
      if (oldestToken) {
        this.pendingChannels.delete(oldestToken);
      }
    }

    this.pendingChannels.set(token, {
      tabId,
      expiresAt: Date.now() + channelLifetimeMs,
    });
    return true;
  }

  static claim(token: string, sender: browser.Runtime.MessageSender): boolean {
    const tabId = sender.tab?.id;
    if (
      tabId === undefined ||
      !this.isExtensionIframe(sender) ||
      !this.isValidToken(token)
    ) {
      return false;
    }

    this.prune();
    const pending = this.pendingChannels.get(token);
    this.pendingChannels.delete(token);

    return (
      pending !== undefined &&
      pending.tabId === tabId &&
      pending.expiresAt >= Date.now()
    );
  }

  private static isWebContentScript(
    sender: browser.Runtime.MessageSender,
  ): boolean {
    try {
      const protocol = new URL(sender.url ?? "").protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }

  private static isExtensionIframe(
    sender: browser.Runtime.MessageSender,
  ): boolean {
    try {
      return sender.url === browser.runtime.getURL("iframe.html");
    } catch {
      return false;
    }
  }

  private static isValidToken(token: string): boolean {
    return /^[a-f0-9]{64}$/.test(token);
  }

  private static prune(): void {
    const now = Date.now();
    for (const [token, pending] of this.pendingChannels) {
      if (pending.expiresAt < now) {
        this.pendingChannels.delete(token);
      }
    }
  }
}
