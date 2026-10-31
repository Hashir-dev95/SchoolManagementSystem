import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { WorkspaceTabs } from '../src/components/hiraDashboard/WorkspaceTabs';

let tree: Renderer.ReactTestRenderer;
const onSelect = jest.fn();
const items = ['Overview', 'Fees & challans'];
async function render(selected: string, values: readonly string[] = items) {
  await act(async () => {
    tree = Renderer.create(
      <WorkspaceTabs
        items={values}
        selected={selected}
        onSelect={onSelect}
        accessibilityLabel="Workspace sections"
      />,
    );
  });
}
function tab(label: string) {
  return tree.root.findAll(
    node =>
      node.props.accessibilityRole === 'tab' &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
}
beforeEach(() => onSelect.mockClear());
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('renders visible labels, a named tablist and selected/unselected accessibility state', async () => {
  await render('Overview');
  expect(JSON.stringify(tree.toJSON())).toContain('Fees & challans');
  expect(
    tree.root.findAllByProps({
      accessibilityRole: 'tablist',
      accessibilityLabel: 'Workspace sections',
    }).length,
  ).toBeGreaterThan(0);
  expect(tab('Overview').props.accessibilityState).toEqual({ selected: true });
  expect(tab('Fees & challans').props.accessibilityState).toEqual({
    selected: false,
  });
});
test('reports intent without mutating selection; the parent controls the active pane', async () => {
  await render('Overview');
  await act(async () => tab('Fees & challans').props.onPress());
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith('Fees & challans');
  expect(tab('Overview').props.accessibilityState.selected).toBe(true);
  await act(async () =>
    tree.update(
      <WorkspaceTabs
        items={items}
        selected="Fees & challans"
        onSelect={onSelect}
        accessibilityLabel="Workspace sections"
      />,
    ),
  );
  expect(tab('Overview').props.accessibilityState.selected).toBe(false);
  expect(tab('Fees & challans').props.accessibilityState.selected).toBe(true);
});
test('empty options render no controls or invented selection', async () => {
  await render('', []);
  expect(tree.toJSON()).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});
