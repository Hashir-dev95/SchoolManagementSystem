import { Schema, model } from 'mongoose';
const ref = (name: string) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required: true,
  immutable: true,
});
const schema = new Schema(
  {
    parentUserId: ref('User'),
    studentId: ref('Student'),
    branchId: ref('Branch'),
    relationship: {
      type: String,
      enum: ['mother', 'father', 'guardian'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'revoked'],
      default: 'pending',
      required: true,
    },
    isActive: { type: Boolean, default: false, required: true },
    createdBy: ref('User'),
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: Date,
  },
  { timestamps: true },
);
schema.index(
  { parentUserId: 1, studentId: 1 },
  { unique: true, name: 'unique_parent_student_relationship' },
);
schema.index({ parentUserId: 1, branchId: 1, status: 1, isActive: 1 });
schema.pre('validate', function () {
  if (
    this.status === 'verified' &&
    (!this.verifiedBy ||
      !this.verifiedAt ||
      this.verifiedAt > new Date() ||
      String(this.verifiedBy) === String(this.parentUserId))
  ) {
    this.invalidate(
      'verifiedAt',
      'Independent administrative verification is required',
    );
  }
});
export const ParentStudentLink = model('ParentStudentLink', schema);
