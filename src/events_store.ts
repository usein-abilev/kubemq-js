import { BaseMessage, Client, TypedEvent } from './client';
import { Config } from './config';
import * as pb from './protos';
import { Utils } from './utils';

/**
 * events store subscription types
 */
export enum EventStoreType {
  StartNewOnly = 1,
  StartFromFirst,
  StartFromLast,
  StartAtSequence,
  StartAtTime,
  StartAtTimeDelta,
}
/**
 * events store base message
 */
export interface EventsStoreMessage extends BaseMessage {}

/**
 * events store received by events store subscriber
 */
export interface EventsStoreReceiveMessage {
  /** send event request id */
  id: string;

  /** channel name */
  channel: string;

  /** event metadata */
  metadata: string;

  /** event payload */
  body: Uint8Array | string;

  /** event key/value tags */
  tags: Map<string, string>;

  /** event timestamp */
  timestamp: number;

  /** event sequence */
  sequence: number;
}
/** events store sending result */
export interface EventsStoreSendResult {
  id: string;
  sent: boolean;
  error: string;
}
/** events store subscription callback */
export interface EventsStoreReceiveMessageCallback {
  (err: Error | null, msg: EventsStoreReceiveMessage): void;
}
/** events store stream callback */
export interface EventsStoreStreamCallback {
  (err: Error | null, result: EventsStoreSendResult): void;
}

/** events store requests subscription */
export interface EventsStoreSubscriptionRequest {
  /** event store subscription channel */
  channel: string;

  /** event store subscription channel group*/
  group?: string;

  /** event store subscription clientId */
  clientId?: string;

  /** event store subscription type */
  requestType: EventStoreType;

  /** event store subscription value - if valid */
  requestTypeValue?: number;
}

/** events subscription response*/
export interface EventsStoreSubscriptionResponse {
  /** emit events on close stream*/
  onClose: TypedEvent<void>;

  /** call unsubscribe*/
  unsubscribe(): void;
}
/** events requests subscription response*/
export interface EventsStoreStreamResponse {
  /** emit events on close stream*/
  onClose: TypedEvent<void>;

  /** write events store to stream*/
  write(msg: EventsStoreMessage): void;

  /** end events store stream*/
  end(): void;
}

/**
 * Events Store Client - KubeMQ events store client
 */
export class EventsStoreClient extends Client {
  /**
   * @internal
   */
  constructor(Options: Config) {
    super(Options);
  }
  /**
   * Send single event
   * @param msg
   * @return Promise<EventsStoreSendResult>
   */
  send(msg: EventsStoreMessage): Promise<EventsStoreSendResult> {
    const pbMessage = new pb.Event();
    pbMessage.setEventid(msg.id ? msg.id : Utils.uuid());
    pbMessage.setClientid(
      msg.clientId ? msg.clientId : this.clientOptions.clientId,
    );
    pbMessage.setChannel(msg.channel);
    pbMessage.setBody(msg.body);
    pbMessage.setMetadata(msg.metadata);
    if (msg.tags != null) {
      pbMessage.getTagsMap().set(msg.tags);
    }
    pbMessage.setStore(true);
    return new Promise<EventsStoreSendResult>((resolve, reject) => {
      this.grpcClient.sendEvent(
        pbMessage,
        this.getMetadata(),
        this.callOptions(),
        (e, result) => {
          if (e) {
            reject(e);
            return;
          }
          if (result != null)
            resolve({
              id: result.getEventid(),
              sent: result.getSent(),
              error: result.getError(),
            });
        },
      );
    });
  }

  /**
   * Send stream of events store
   * @return Promise<EventsStoreStreamCallback>
   * @param cb
   */
  public stream(
    cb: EventsStoreStreamCallback,
  ): Promise<EventsStoreStreamResponse> {
    return new Promise<EventsStoreStreamResponse>((resolve, reject) => {
      if (!cb) {
        reject(new Error('stream events store call requires a callback'));
        return;
      }
      const stream = this.grpcClient.sendEventsStream(this.getMetadata());
      stream.on('data', (result: pb.Result) => {
        cb(null, {
          id: result.getEventid(),
          sent: result.getSent(),
          error: result.getError(),
        });
      });

      stream.on('error', (e: Error) => {
        cb(e, null);
      });
      let onCloseEvent = new TypedEvent<void>();
      stream.on('close', () => {
        onCloseEvent.emit();
      });

      const writeFn = (msg: EventsStoreMessage) => {
        const pbMessage = new pb.Event();
        pbMessage.setEventid(msg.id ? msg.id : Utils.uuid());
        pbMessage.setClientid(
          msg.clientId ? msg.clientId : this.clientOptions.clientId,
        );
        pbMessage.setChannel(msg.channel);
        pbMessage.setBody(msg.body);
        pbMessage.setMetadata(msg.metadata);
        if (msg.tags != null) {
          pbMessage.getTagsMap().set(msg.tags);
        }
        pbMessage.setStore(true);
        stream.write(pbMessage, (err: Error) => {
          cb(err, null);
        });
      };

      resolve({
        onClose: onCloseEvent,
        write: writeFn,
        end(): void {
          stream.end();
        },
      });
    });
  }

  /**
   * Subscribe to events store messages
   * @param request
   * @param cb
   * @return Promise<EventsStoreSubscriptionResponse>
   */
  public subscribe(
    request: EventsStoreSubscriptionRequest,
    cb: EventsStoreReceiveMessageCallback,
  ): Promise<EventsStoreSubscriptionResponse> {
    return new Promise<EventsStoreSubscriptionResponse>((resolve, reject) => {
      if (!cb) {
        reject(new Error('events store subscription requires a callback'));
        return;
      }
      const pbSubRequest = new pb.Subscribe();
      pbSubRequest.setClientid(
        request.clientId ? request.clientId : this.clientOptions.clientId,
      );
      pbSubRequest.setGroup(request.group ? request.group : '');
      pbSubRequest.setChannel(request.channel);
      pbSubRequest.setSubscribetypedata(2);
      pbSubRequest.setEventsstoretypedata(request.requestType);
      pbSubRequest.setEventsstoretypevalue(request.requestTypeValue);

      const stream = this.grpcClient.subscribeToEvents(
        pbSubRequest,
        this.getMetadata(),
      );
      stream.on('data', (data: pb.EventReceive) => {
        cb(null, {
          id: data.getEventid(),
          channel: data.getChannel(),
          metadata: data.getMetadata(),
          body: data.getBody(),
          tags: data.getTagsMap(),
          timestamp: data.getTimestamp(),
          sequence: data.getSequence(),
        });
      });
      stream.on('error', (e: Error) => {
        cb(e, null);
      });
      let onCloseEvent = new TypedEvent<void>();
      stream.on('close', () => {
        onCloseEvent.emit();
      });
      resolve({
        onClose: onCloseEvent,
        unsubscribe() {
          stream.cancel();
        },
      });
    });
  }
}
