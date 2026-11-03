import { Schema, model } from 'mongoose';

const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const conversation = new Schema(
  {
    branchId: ref('Branch'),
    participantLow: ref('User'),
    participantHigh: ref('User'),
    lastSequence: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    },
  },
  { timestamps: true },
);
conversation.pre('validate', function () {
  if (String(this.participantLow) >= String(this.participantHigh))
    this.invalidate(
      'participantLow',
      'Participants must be distinct and ordered',
    );
});
conversation.index(
  { branchId: 1, participantLow: 1, participantHigh: 1 },
  { unique: true, name: 'chat_direct_pair_unique' },
);
conversation.index({ branchId: 1, participantLow: 1, updatedAt: -1, _id: -1 });
conversation.index({ branchId: 1, participantHigh: 1, updatedAt: -1, _id: -1 });
export const ChatConversation = model('ChatConversation', conversation);

const message = new Schema(
  {
    conversationId: ref('ChatConversation'),
    branchId: ref('Branch'),
    senderUserId: ref('User'),
    recipientUserId: ref('User'),
    body: {
      type: String,
      required: true,
      immutable: true,
      minlength: 1,
      maxlength: 4000,
    },
    sequence: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      validate: Number.isSafeInteger,
    },
    operationId: {
      type: String,
      required: true,
      immutable: true,
      minlength: 16,
      maxlength: 80,
      select: false,
    },
    fingerprint: {
      type: String,
      required: true,
      immutable: true,
      select: false,
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
message.index(
  { senderUserId: 1, operationId: 1 },
  { unique: true, name: 'chat_sender_operation_unique' },
);
message.index(
  { conversationId: 1, sequence: 1 },
  { unique: true, name: 'chat_conversation_sequence_unique' },
);
message.index({ conversationId: 1, sequence: -1, _id: -1 });
message.index({ conversationId: 1, recipientUserId: 1, readAt: 1 });
export const ChatMessage = model('ChatMessage', message);
export const ensureChatIndexes = async () => {
  await ChatConversation.createIndexes();
  await ChatMessage.createIndexes();
};
