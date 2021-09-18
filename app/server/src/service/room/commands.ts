import { ChangeTopicStateType } from "../../events"
import Topic from "../../domain/room/Topic"

export type BuildRoomCommand = {
  title: string
  topics: Omit<Topic, "id" | "state">[]
}

export type ChangeTopicStateCommand = {
  userId: string
  topicId: string
  type: ChangeTopicStateType
}
