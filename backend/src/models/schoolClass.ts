import {Schema, model} from 'mongoose';

export interface ISchoolClass {
  branchId: Schema.Types.ObjectId;
  name: string;
  code: string;
  academicYear: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schoolClassSchema = new Schema<ISchoolClass>(
  {
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },

    academicYear: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

schoolClassSchema.index(
  {branchId: 1, code: 1, academicYear: 1},
  {unique: true},
);

const SchoolClass = model<ISchoolClass>(
  'SchoolClass',
  schoolClassSchema,
);

export default SchoolClass;