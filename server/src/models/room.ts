import { Server } from "socket.io";
import {
  Answer,
  ChatItem,
  ChatItemBase,
  Message,
  Question,
  Topic,
  TopicState,
  User,
} from "../chatItem";
import {
  AdminChangeTopicStateParams,
  PostChatItemParams,
  PostStampParams,
  PubStampParams,
} from "../events";
import { IServerSocket } from "../serverSocket";
import { Stamp } from "../stamp";

type MessageStore = ChatItemBase & {
  type: "message";
  content: string;
  target: string | null;
};

type ReactionStore = ChatItemBase & {
  type: "reaction";
  target: string;
};

type QuestionStore = ChatItemBase & {
  type: "question";
  content: string;
};

type AnswerStore = ChatItemBase & {
  type: "answer";
  content: string;
  target: string;
};

type ChatItemStore = MessageStore | ReactionStore | QuestionStore | AnswerStore;

type StampStore = Stamp & {
  createdAt: Date;
};

class RoomClass {
  public static globalSocket: Server;

  private users: (User & { socket: IServerSocket })[] = [];
  private chatItems: ChatItemStore[] = [];
  public topics: (Topic & { state: TopicState })[];
  public stamps: StampStore[] = [];
  private isOpened = false;

  public get activeUserCount(): number {
    return this.users.length;
  }

  public getChatItems = () => this.chatItems.map(this.chatItemStoreToChatItem);

  constructor(
    public readonly id: string,
    public readonly title: string,
    topics: Omit<Topic, "id">[]
  ) {
    this.topics = topics.map((topic, i) => ({
      ...topic,
      id: `${i + 1}`,
      state: "not-started",
    }));
  }

  /**
   * ルームを開始する
   */
  public startRoom = () => {
    if (this.isOpened) {
      throw new Error("[sushi-chat-server] Room has already opened.");
    }
    this.isOpened = true;
    RoomClass.globalSocket.to(this.id).emit("PUB_START_ROOM", {});
  };

  public finishRoom = () => {
    this.isOpened = false;
    RoomClass.globalSocket.to(this.id).emit("PUB_FINISH_ROOM", {});
  };

  public closeRoom = () => {
    this.isOpened = false;
    RoomClass.globalSocket.to(this.id).emit("PUB_CLOSE_ROOM", {});
  };

  /**
   * ユーザーがルームに参加した場合に呼ばれる関数
   * @param socket
   * @param iconId
   * @returns
   */
  public joinUser = (socket: IServerSocket, iconId: string) => {
    this.users.push({ id: socket.id, iconId, socket });
    socket.broadcast("PUB_ENTER_ROOM", {
      iconId,
      activeUserCount: this.users.length,
    });
  };

  /**
   * ユーザーがルームから退室した場合に呼ばれる関数
   * @param userId
   */
  public leaveUser = (userId: string) => {
    const leavedUser = this.users.find((user) => user.id !== userId);
    if (leavedUser == null) {
      throw new Error("[sushi-chat-server] User does not exists.");
    }
    this.users = this.users.filter((user) => user.id !== leavedUser.id);
    RoomClass.globalSocket.to(this.id).emit("PUB_LEAVE_ROOM", {
      iconId: leavedUser.iconId,
      activeUserCount: this.users.length,
    });
  };

  /**
   * トピックの状態を変更するときに呼ばれる関数
   */
  public changeTopicState = (params: AdminChangeTopicStateParams) => {
    if (!this.isOpened) {
      throw new Error("[sushi-chat-server] Room is not opened.");
    }
    const targetTopic = this.getTopicById(params.topicId);
    if (targetTopic == null) {
      throw new Error("[sushi-chat-server] Topic does not exists.");
    }
    if (params.type === "OPEN") {
      // 現在activeであるトピックをCfinishedにし、指定したトピックをopenにする
      const currentActiveTopic = this.activeTopic;
      if (currentActiveTopic != null) {
        currentActiveTopic.state = "finished";
      }
      targetTopic.state = "active";
    } else if (params.type === "PAUSE") {
      targetTopic.state = "paused";
    } else if (params.type === "CLOSE") {
      targetTopic.state = "finished";
    } else {
      throw new Error("[sushi-chat-server] Type is invalid.");
    }
    // stateの変更を送信する
    RoomClass.globalSocket.to(this.id).emit("PUB_CHANGE_TOPIC_STATE", {
      type: params.type,
      topicId: params.topicId,
    });
  };

  /**
   * 新しくスタンプが投稿された時に呼ばれる関数。
   * @param userId
   */
  public postStamp = (userId: string, params: PostStampParams) => {
    if (!this.isOpened) {
      throw new Error("[sushi-chat-server] Room is not opened.");
    }
    // ユーザーの存在チェック
    if (!this.userIdExistCheck(userId)) {
      throw new Error("[sushi-chat-server] User does not exists.");
    }
    // TODO: topicIDの存在チェック
    // 配列に保存
    this.stamps.push({
      topicId: params.topicId,
      userId,
      timestamp: 0, // TODO: 正しいタイムスタンプを設定
      createdAt: new Date(),
    });
    // 配信する
    this.getSocketByUserId(userId).broadcast("PUB_STAMP", {
      iconId: this.getIconId(userId),
      topicId: params.topicId,
    });
  };

  /**
   * 新しくチャットが投稿された時に呼ばれる関数。
   * @param userId
   * @param chatItemParams
   */
  public postChatItem = (userId: string, chatItemParams: PostChatItemParams) => {
    if (!this.isOpened) {
      throw new Error("[sushi-chat-server] Room is not opened.");
    }
    // TODO: not-startedなルームには投稿できない
    // ユーザーの存在チェック
    if (!this.userIdExistCheck(userId)) {
      throw new Error("[sushi-chat-server] User does not exists.");
    }
    // フロントから送られてきたパラメータをこのクラスで保存する形式に変換する
    const chatItem = this.addServerInfo(userId, chatItemParams);
    // 配列に保存
    this.chatItems.push(chatItem);
    // サーバでの保存形式をフロントに返すレスポンスの形式に変換して配信する
    this.getSocketByUserId(userId).broadcast(
      "PUB_CHAT_ITEM",
      this.chatItemStoreToChatItem(chatItem)
    );
  };

  /**
   * フロントから送られてきたチャットアイテムにサーバーの情報を付与する
   * @param userId ユーザID
   * @param chatItem チャットアイテム
   * @returns
   */
  private addServerInfo = (userId: string, chatItem: PostChatItemParams): ChatItemStore => {
    if (chatItem.type === "reaction") {
      const { reactionToId, ...rest } = chatItem;
      return {
        timestamp: 0, // TODO: 正しいタイムスタンプを設定
        iconId: this.getIconId(userId) as string,
        createdAt: new Date(),
        target: reactionToId,
        ...rest,
      };
    } else {
      return {
        timestamp: 0, // TODO: 正しいタイムスタンプを設定
        iconId: this.getIconId(userId) as string,
        createdAt: new Date(),
        ...chatItem,
      };
    }
  };

  /**
   * フロントに返すチャットアイテムを整形する関数
   * 具体的にはリプライ先のChatItemなどで、IDのみ保存されている部分をChatItemに置き換えて返す
   *
   * @param chatItemStore
   * @returns フロントに返すためのデータ
   */
  private chatItemStoreToChatItem = (chatItemStore: ChatItemStore): ChatItem => {
    if (chatItemStore.type === "message") {
      if (chatItemStore.target == null) {
        // 通常メッセージ
        return {
          ...chatItemStore,
          target: null,
        };
      } else {
        // リプライメッセージ
        // リプライ先のメッセージを取得する
        const targetChatItemStore = this.chatItems.find(
          ({ id, type }) => id === chatItemStore.target && (type === "answer" || type === "message")
        );
        if (targetChatItemStore == null) {
          throw new Error("[sushi-chat-server] Reply target message does not exists.");
        }
        return {
          ...chatItemStore,
          target: this.chatItemStoreToChatItem(targetChatItemStore) as Answer | Message,
        };
      }
    } else if (chatItemStore.type === "reaction") {
      // リアクション
      const targetChatItemStore = this.chatItems.find(
        ({ id, type }) =>
          id === chatItemStore.target &&
          (type === "message" || type === "question" || type === "answer")
      );
      if (targetChatItemStore == null) {
        throw new Error("[sushi-chat-server] Reaction target message does not exists.");
      }
      return {
        ...chatItemStore,
        target: this.chatItemStoreToChatItem(targetChatItemStore) as Message | Answer | Question,
      };
    } else if (chatItemStore.type === "question") {
      // 質問
      return chatItemStore;
    } else {
      // 回答
      const targetChatItemStore = this.chatItems.find(
        ({ id, type }) => id === chatItemStore.target && type === "question"
      );
      if (targetChatItemStore == null) {
        throw new Error("[sushi-chat-server] Answer target message does not exists.");
      }
      return {
        ...chatItemStore,
        target: this.chatItemStoreToChatItem(targetChatItemStore) as Question,
      };
    }
  };

  // utils
  private userIdExistCheck = (userId: string) => {
    return this.users.find(({ id }) => id === userId) != null;
  };

  private getIconId = (userId: string) => {
    const iconId = this.users.find(({ id }) => id === userId)?.iconId;
    if (iconId == null) {
      throw new Error("[sushi-chat-server] User does not exists.");
    }
    return iconId;
  };

  private getSocketByUserId = (userId: string) => {
    const socket = this.users.find(({ id }) => id === userId)?.socket;
    if (socket == null) {
      throw new Error("[sushi-chat-server] User does not exists.");
    }
    return socket;
  };

  private get activeTopic() {
    return this.topics.find(({ state }) => state === "active") ?? null;
  }

  private getTopicById = (topicId: string) => {
    return this.topics.find((topic) => topic.id === topicId);
  };
}

export default RoomClass;