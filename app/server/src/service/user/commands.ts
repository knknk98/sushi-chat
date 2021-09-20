export type CreateUserCommand = {
  userId: string
  idToken?: string
}

export type AdminEnterCommand = {
  userId: string
  roomId: string
}

export type UserEnterCommand = {
  roomId: string
  userId: string
  iconId: number
  speakerTopicId?: number
}

export type UserLeaveCommand = {
  userId: string
}
