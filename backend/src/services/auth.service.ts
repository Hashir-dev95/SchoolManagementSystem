import User, {IUser, UserRole} from '../models/user';
import {comparePassword, hashPassword} from '../utils/password';

interface CreateUserInput {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  role: UserRole;
  branchId?: string;
}

export const createUser = async (
  data: CreateUserInput,
): Promise<IUser> => {
  const existingUser = await User.findOne({
    email: data.email.toLowerCase(),
  });

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const hashedPassword = await hashPassword(data.password);

  const user = new User({
    fullName: data.fullName,
    email: data.email.toLowerCase(),
    phone: data.phone,
    password: hashedPassword,
    role: data.role,
    branchId: data.branchId,
  });

  await user.save();

  return user;
};

export const authenticateUser = async (
  email: string,
  password: string,
): Promise<IUser> => {
  const user = await User.findOne({
    email: email.toLowerCase(),
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  const passwordMatches = await comparePassword(
    password,
    user.password,
  );

  if (!passwordMatches) {
    throw new Error('Invalid email or password');
  }

  if (!user.isActive) {
    throw new Error('User account is inactive');
  }

  return user;
};