import { BaseMessage, Client } from './client';
import { Config } from './config';
import * as pb from '../src/protos';
import { Utils } from './utils';

export interface EventsMessage extends BaseMessage {}
export interface EventsReceiveMessage {
  id: string;
  channel: string;
  metadata: string;
  body: Uint8Array | string;
  tags: Map<string, string>;
}
export interface EventsSendResult {
  id: string;
  sent: boolean;
}

export interface EventsSubscriptionRequest {
  channel: string;
  group?: string;
  clientId?: string;
  onEventFn?: (event: EventsReceiveMessage) => void;
  onErrorFn?: (e: Error) => void;
  onCloseFn?: () => void;
}

export interface EventsSubscriptionResponse {
  cancel(): void;
}

export interface EventsStreamRequest {
  onErrorFn?: (e: Error) => void;
  onCloseFn?: () => void;
}

export interface EventsStreamResponse {
  write(message: EventsMessage): void;
  end(): void;
  cancel(): void;
}

export class EventsClient extends Client {
  constructor(Options: Config) {
    super(Options);
  }

  public send(message: EventsMessage): Promise<EventsSendResult> {
    const pbMessage = new pb.Event();
    pbMessage.setEventid(message.id ? message.id : Utils.uuid());
    pbMessage.setClientid(
      message.clientId ? message.clientId : this.clientOptions.clientId,
    );
    pbMessage.setChannel(message.channel);
    pbMessage.setBody(message.body);
    pbMessage.setMetadata(message.metadata);
    if (message.tags != null) {
      pbMessage.getTagsMap().set(message.tags);
    }
    pbMessage.setStore(false);
    return new Promise<EventsSendResult>((resolve, reject) => {
      this.grpcClient.sendEvent(
        pbMessage,
        this.metadata(),
        this.callOptions(),
        (e) => {
          if (e) reject(e);
          resolve({ id: pbMessage.getEventid(), sent: true });
        },
      );
    });
  }
  public stream(request: EventsStreamRequest): EventsStreamResponse {
    const stream = this.grpcClient.sendEventsStream(
      this.metadata(),
      this.callOptions(),
    );
    stream.on('error', function (e: Error) {
      if (request.onErrorFn != null) {
        request.onErrorFn(e);
      }
    });

    stream.on('close', function () {
      if (request.onCloseFn != null) {
        request.onCloseFn();
      }
    });
    const clientIdFromOptions = this.clientOptions.clientId;
    const writeFn = function (message: EventsMessage): void {
      const pbMessage = new pb.Event();
      pbMessage.setEventid(message.id ? message.id : Utils.uuid());
      pbMessage.setClientid(
        message.clientId ? message.clientId : clientIdFromOptions,
      );
      pbMessage.setChannel(message.channel);
      pbMessage.setBody(message.body);
      pbMessage.setMetadata(message.metadata);
      if (message.tags != null) {
        pbMessage.getTagsMap().set(message.tags);
      }
      pbMessage.setStore(false);
      stream.write(pbMessage);
    };
    return { write: writeFn, cancel: stream.cancel, end: stream.end };
  }
  public subscribe(
    request: EventsSubscriptionRequest,
  ): EventsSubscriptionResponse {
    const pbSubRequest = new pb.Subscribe();
    pbSubRequest.setClientid(
      request.clientId ? request.clientId : this.clientOptions.clientId,
    );
    pbSubRequest.setGroup(request.group ? request.group : '');
    pbSubRequest.setChannel(request.channel);
    pbSubRequest.setSubscribetypedata(1);
    const stream = this.grpcClient.subscribeToEvents(
      pbSubRequest,
      this.metadata(),
      this.callOptions(),
    );
    stream.on('data', function (data: pb.EventReceive) {
      if (request.onEventFn != null) {
        request.onEventFn({
          id: data.getEventid(),
          channel: data.getChannel(),
          metadata: data.getMetadata(),
          body: data.getBody(),
          tags: data.getTagsMap(),
        });
      }
    });

    stream.on('error', function (e: Error) {
      if (request.onErrorFn != null) {
        request.onErrorFn(e);
      }
    });

    stream.on('close', function () {
      if (request.onCloseFn != null) {
        request.onCloseFn();
      }
    });
    return { cancel: stream.cancel };
  }
}
