import type { SignedObject, SubscriptionFilter } from '@agora/core';
import type { ConnectionStatus, EventHandler, EoseHandler, StatusHandler, SignalHandler, PeersHandler } from './relay.js';

/** Common interface for RelayClient and RelayPool */
export interface RelayLike {
  onEvent(handler: EventHandler): void;
  onEose(handler: EoseHandler): void;
  onStatusChange(handler: StatusHandler): void;
  onSignal(handler: SignalHandler): void;
  onPeers(handler: PeersHandler): void;
  connect(): void;
  disconnect(): void;
  subscribe(id: string, filters: SubscriptionFilter[]): void;
  publish(object: SignedObject): void;
  sendSignal(target: string, signalType: string, data: any): void;
  requestPeers(): void;
  send(msg: object): void;
  readonly connected: boolean;
}
