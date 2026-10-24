import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import {
  AdminDialog,
  AdminSelect,
  AdminFeedback,
} from '../src/components/hiraDashboard/AdminForm';
import { Button } from '../src/components/hiraDashboard';
import {
  StudentAdmissionForm,
  StudentProfilePanel,
  studentFormErrors,
} from '../src/screens/principal/StudentProfileForms';
import { studentAdminService } from '../src/services/admin/studentAdminService';
import { enrollmentService } from '../src/services/admin/enrollmentService';
import { ApiError } from '../src/services/api/apiClient';
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));
jest.mock('../src/services/admin/studentAdminService', () => ({
  studentAdminService: {
    admit: jest.fn(),
    profile: jest.fn(),
    edit: jest.fn(),
  },
}));
jest.mock('../src/services/admin/enrollmentService', () => ({
  enrollmentService: { options: jest.fn() },
}));
const api = jest.mocked(studentAdminService),
  catalogs = jest.mocked(enrollmentService),
  trees: Renderer.ReactTestRenderer[] = [];
const onClose = jest.fn(),
  onCreated = jest.fn(),
  onSaved = jest.fn(),
  onAcademicSetup = jest.fn();
const profile = {
  id: 'student-1',
  fullName: 'Ahmed Khan',
  admissionNumber: 'ST-1023',
  email: 'ahmed@example.org',
  phone: '',
  dateOfBirth: '2012-02-29',
  gender: 'male',
  guardianName: 'Guardian Khan',
  guardianPhone: '',
  address: '',
  isActive: true,
  revision: 0,
};
const options = {
  period: { id: 'period-1', name: 'Academic Year 2026', code: 'AY26' },
  classes: [
    { id: 'class-1', name: 'Grade 8', code: 'G8' },
    { id: 'class-2', name: 'Grade 9', code: 'G9' },
  ],
  sections: [{ id: 'section-1', name: 'Section A', code: 'A' }],
  nextOffset: null,
};
const text = (tree: Renderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());
const dialog = (tree: Renderer.ReactTestRenderer) =>
  tree.root.findAllByType(AdminDialog).find(node => node.props.visible)!;
const button = (tree: Renderer.ReactTestRenderer, title: string) =>
  tree.root.findAllByType(Button).find(node => node.props.title === title)!;
async function mount(element?: React.ReactElement) {
  let tree!: Renderer.ReactTestRenderer;
  await act(async () => {
    tree = Renderer.create(
      element ?? (
        <StudentAdmissionForm
          token="token"
          onClose={onClose}
          onCreated={onCreated}
          onAcademicSetup={onAcademicSetup}
        />
      ),
    );
  });
  trees.push(tree);
  return tree;
}
async function input(
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) {
  await act(async () =>
    tree.root
      .findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === label)!
      .props.onChangeText(value),
  );
}
async function select(
  tree: Renderer.ReactTestRenderer,
  label: string,
  value: string,
) {
  await act(async () =>
    tree.root
      .findAllByType(AdminSelect)
      .find(node => node.props.label === label)!
      .props.onSelect(value),
  );
}
async function review(tree: Renderer.ReactTestRenderer) {
  await input(tree, 'Full name', profile.fullName);
  await input(tree, 'Admission number', profile.admissionNumber);
  await input(tree, 'Student account email', profile.email);
  await input(tree, 'Initial password', 'Secure-fixture-password');
  await select(tree, 'Admission Class', 'class-1');
  await select(tree, 'Admission Section', 'section-1');
  await act(async () => dialog(tree).props.onConfirm());
}
beforeEach(() => {
  jest.clearAllMocks();
  catalogs.options.mockResolvedValue(options);
  api.admit.mockResolvedValue({
    student: profile,
    capabilities: { editProfile: true },
  });
  api.profile.mockResolvedValue({
    student: profile,
    capabilities: { editProfile: true },
  });
  api.edit.mockResolvedValue({
    student: { ...profile, revision: 1 },
    capabilities: { editProfile: true },
  });
});
afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
});
test('admission opens grouped Hira form and loads authoritative academic context', async () => {
  const tree = await mount();
  expect(catalogs.options).toHaveBeenCalledWith('token', undefined, 0);
  expect(text(tree)).toContain('Guardian / contact');
  expect(text(tree)).toContain('Student login account');
  expect(text(tree)).toContain('Academic placement');
  expect(dialog(tree).props.title).toBe('Add Student');
});
test('required fields show inline validation without sending admission or an outcome alert', async () => {
  const tree = await mount();
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.admit).not.toHaveBeenCalled();
  expect(text(tree)).toContain('Enter the Student');
  expect(dialog(tree).props.title).toBe('Add Student');
});
test('valid admission requires review and presents existing success dialog with View Student', async () => {
  const tree = await mount();
  await review(tree);
  expect(dialog(tree).props.title).toBe('Review Student admission');
  expect(api.admit).not.toHaveBeenCalled();
  expect(text(tree)).not.toContain('Secure-fixture-password');
  await act(async () => dialog(tree).props.onConfirm());
  expect(api.admit).toHaveBeenCalledWith(
    'token',
    expect.objectContaining({
      fullName: profile.fullName,
      admissionNumber: profile.admissionNumber,
      academicPeriodId: 'period-1',
      classId: 'class-1',
      sectionId: 'section-1',
      operationId: expect.any(String),
    }),
  );
  expect(dialog(tree).props.title).toBe('Student Created');
  expect(dialog(tree).props.confirmTitle).toBe('View Student');
  expect(
    tree.root
      .findAllByType(AdminFeedback)
      .some(node => node.props.kind === 'success'),
  ).toBe(true);
  await act(async () => dialog(tree).props.onConfirm());
  expect(onCreated).toHaveBeenCalledWith('student-1');
});
test('double confirm sends one request, waits for confirmation and exposes busy state', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof studentAdminService.admit>>,
  ) => void;
  api.admit.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const tree = await mount();
  await review(tree);
  await act(async () => {
    dialog(tree).props.onConfirm();
    dialog(tree).props.onConfirm();
  });
  expect(api.admit).toHaveBeenCalledTimes(1);
  expect(dialog(tree).props.busy).toBe(true);
  expect(text(tree)).not.toContain('Student Created');
  await act(async () =>
    finish({ student: profile, capabilities: { editProfile: true } }),
  );
  expect(dialog(tree).props.title).toBe('Student Created');
});
test('duplicate conflict is a safe Hira dialog and preserves input', async () => {
  api.admit.mockRejectedValueOnce(
    new ApiError(409, 'Admission number is already in use'),
  );
  const tree = await mount();
  await review(tree);
  await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.title).toBe('Student Already Exists');
  await act(async () => dialog(tree).props.onClose());
  expect(
    tree.root
      .findAllByType(TextInput)
      .find(node => node.props.accessibilityLabel === 'Full name')!.props.value,
  ).toBe(profile.fullName);
});
test.each([
  new Error('Network interrupted'),
  new ApiError(500, 'Server unavailable'),
])(
  'uncertain admission retries immutable payload and same operation: %s',
  async failure => {
    api.admit.mockRejectedValueOnce(failure);
    const tree = await mount();
    await review(tree);
    await act(async () => dialog(tree).props.onConfirm());
    expect(text(tree)).toContain('Admission was not confirmed');
    expect(dialog(tree).props.confirmTitle).toBe('Retry admission safely');
    expect(onCreated).not.toHaveBeenCalled();
    await act(async () => dialog(tree).props.onConfirm());
    expect(api.admit.mock.calls[1][1]).toEqual(api.admit.mock.calls[0][1]);
  },
);
test('permission failure shows safe action feedback and ends loading', async () => {
  api.admit.mockRejectedValueOnce(new ApiError(403, 'internal-policy-marker'));
  const tree = await mount();
  await review(tree);
  await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.title).toBe('Action Not Available');
  expect(text(tree)).not.toContain('internal-policy-marker');
});
test('Class change clears a previously selected Section', async () => {
  const tree = await mount();
  await select(tree, 'Admission Class', 'class-1');
  await select(tree, 'Admission Section', 'section-1');
  await select(tree, 'Admission Class', 'class-2');
  expect(
    tree.root
      .findAllByType(AdminSelect)
      .find(node => node.props.label === 'Admission Section')!.props.value,
  ).toBe('');
});
test('out-of-order Class requests cannot restore old Sections', async () => {
  const tree = await mount();
  const choose = tree.root
    .findAllByType(AdminSelect)
    .find(node => node.props.label === 'Admission Class')!.props.onSelect;
  let old!: (value: typeof options) => void,
    latest!: (value: typeof options) => void;
  catalogs.options
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          old = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          latest = resolve;
        }),
    );
  await act(async () => {
    choose('class-1');
    choose('class-2');
  });
  await act(async () =>
    latest({
      ...options,
      sections: [{ id: 'new-section', name: 'Latest Section', code: 'NEW' }],
    }),
  );
  await act(async () => old(options));
  expect(
    tree.root
      .findAllByType(AdminSelect)
      .find(node => node.props.label === 'Admission Section')!.props.options[0]
      .id,
  ).toBe('new-section');
});
test.each(['period', 'classes', 'sections'] as const)(
  'missing %s has configuration guidance rather than blank selection',
  async kind => {
    catalogs.options.mockResolvedValueOnce({
      ...options,
      ...(kind === 'period'
        ? { period: null, classes: [], sections: [] }
        : kind === 'classes'
        ? { classes: [] }
        : { sections: [] }),
    });
    const tree = await mount();
    if (kind === 'period') {
      expect(text(tree)).toContain('Academic Setup Required');
      await act(async () =>
        button(tree, 'Open Academic Setup').props.onPress(),
      );
      expect(onAcademicSetup).toHaveBeenCalled();
    }
    if (kind === 'classes')
      expect(text(tree)).toContain('No Classes are configured');
    if (kind === 'sections') {
      catalogs.options.mockResolvedValueOnce({ ...options, sections: [] });
      await select(tree, 'Admission Class', 'class-1');
      expect(text(tree)).toContain('No Sections exist');
    }
    expect(api.admit).not.toHaveBeenCalled();
  },
);
test('academic failure is distinct and retryable', async () => {
  catalogs.options.mockRejectedValueOnce(new Error('Catalog unavailable'));
  const tree = await mount();
  expect(text(tree)).toContain('Academic options unavailable');
  await act(async () =>
    button(tree, 'Retry academic placement').props.onPress(),
  );
  expect(text(tree)).toContain('Academic Year 2026');
});
test('academic loading is visible and late unmounted request is ignored', async () => {
  let finish!: (value: typeof options) => void;
  catalogs.options.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const tree = await mount();
  expect(text(tree)).toContain('Loading academic placement');
  await act(async () => tree.unmount());
  await act(async () => finish(options));
});
test('profile separates permanent fields from enrollment actions and uses safe edit payload', async () => {
  const tree = await mount(
    <StudentProfilePanel token="token" id="student-1" onSaved={onSaved} />,
  );
  expect(text(tree)).toContain('Guardian Khan');
  await act(async () => button(tree, 'Edit Profile').props.onPress());
  await input(tree, 'Full name', 'Ahmed Updated');
  await act(async () => dialog(tree).props.onConfirm());
  const body = api.edit.mock.calls[0][2];
  expect(body.revision).toBe(0);
  expect(body.fullName).toBe('Ahmed Updated');
  expect(body).not.toHaveProperty('classId');
  expect(body).not.toHaveProperty('email');
  expect(dialog(tree).props.title).toBe('Profile saved');
  expect(onSaved).toHaveBeenCalled();
});
test('profile stale error requires authoritative refresh and does not invent success', async () => {
  api.edit.mockRejectedValueOnce(new ApiError(409, 'Student profile changed'));
  const tree = await mount(
    <StudentProfilePanel token="token" id="student-1" onSaved={onSaved} />,
  );
  await act(async () => button(tree, 'Edit Profile').props.onPress());
  await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.title).toBe('Profile Conflict');
  expect(onSaved).not.toHaveBeenCalled();
  await act(async () => dialog(tree).props.onClose());
  expect(api.profile).toHaveBeenCalledTimes(2);
});
test('profile fetch failure is visible and retry clears the error', async () => {
  api.profile.mockRejectedValueOnce(
    new ApiError(404, 'Student is unavailable'),
  );
  const tree = await mount(
    <StudentProfilePanel token="token" id="student-1" onSaved={onSaved} />,
  );
  expect(text(tree)).toContain('Student is unavailable');
  await act(async () =>
    button(tree, 'Refresh Student profile').props.onPress(),
  );
  expect(text(tree)).toContain('Ahmed Khan');
});
test('read-only profile capability hides edit', async () => {
  api.profile.mockResolvedValueOnce({
    student: profile,
    capabilities: { editProfile: false },
  });
  const tree = await mount(
    <StudentProfilePanel token="token" id="student-1" onSaved={onSaved} />,
  );
  expect(button(tree, 'Edit Profile')).toBeUndefined();
});

test('profile authority loss clears previously loaded permanent information', async () => {
  api.edit.mockRejectedValueOnce(
    new ApiError(403, 'Private authority details'),
  );
  const tree = await mount(
    <StudentProfilePanel token="token" id="student-1" onSaved={onSaved} />,
  );
  await act(async () => button(tree, 'Edit Profile').props.onPress());
  await act(async () => dialog(tree).props.onConfirm());
  expect(dialog(tree).props.title).toBe('Action Not Available');
  expect(text(tree)).not.toContain('Guardian Khan');
  expect(text(tree)).not.toContain('Private authority details');
  expect(onSaved).not.toHaveBeenCalled();
});
test('date and account convenience validation rejects ambiguity and invalid calendar dates', () => {
  const fields = { ...profile, dateOfBirth: '2012-02-30' };
  expect(studentFormErrors(fields, 'invalid', 'short')).toHaveProperty(
    'dateOfBirth',
  );
  expect(studentFormErrors(fields, 'invalid', 'short')).toHaveProperty('email');
  expect(
    studentFormErrors(
      { ...fields, dateOfBirth: '2012-02-29' },
      profile.email,
      'Valid-long-password',
    ),
  ).toEqual({});
});
