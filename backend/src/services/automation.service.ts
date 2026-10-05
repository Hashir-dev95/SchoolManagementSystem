import {Types} from 'mongoose';
import Automation, {IAutomation} from '../models/automation';

const DEFAULT_AUTOMATIONS = [
  {
    key: 'attendance_alerts',
    name: 'Automated Attendance Alerts',
    description: 'Sends daily notifications to parents for unexcused student absences.',
    isPaused: false,
  },
  {
    key: 'fee_reminders',
    name: 'Fee Due Date Reminders',
    description: 'Sends automated fee reminder SMS and emails before due dates.',
    isPaused: false,
  },
  {
    key: 'report_card_generator',
    name: 'Nightly Report Card Generator',
    description: 'Generates PDF report cards for finished terms during off-peak hours.',
    isPaused: false,
  },
];

export const getAutomations = async (): Promise<IAutomation[]> => {
  let automations = await Automation.find().sort({createdAt: 1});

  if (automations.length === 0) {
    await Automation.insertMany(DEFAULT_AUTOMATIONS);
    automations = await Automation.find().sort({createdAt: 1});
  }

  return automations;
};

export const toggleAutomationPause = async (
  key: string,
  isPaused: boolean,
  userId: string,
): Promise<IAutomation> => {
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid user ID');
  }

  let automation = await Automation.findOne({key});

  if (!automation) {
    // Check if key is in default list and seed it if needed
    const defaultAuto = DEFAULT_AUTOMATIONS.find(a => a.key === key);
    if (!defaultAuto) {
      throw new Error('Automation key not found');
    }
    automation = await Automation.create(defaultAuto);
  }

  automation.isPaused = isPaused;
  automation.pausedBy = isPaused ? new Types.ObjectId(userId) : undefined;
  automation.pausedAt = isPaused ? new Date() : undefined;

  await automation.save();

  return automation;
};
