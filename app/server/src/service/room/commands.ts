import Topic from "../../domain/room/Topic"

export type BuildRoomCommand = {
  id: string
  title: string
  topics: Omit<Topic, "id" | "state">[]
}

export type ChangeTopicStateCommand = {
  userId: string
  topicId: string
  type: "CLOSE_AND_OPEN" | "PAUSE" | "OPEN" | "CLOSE"
}
