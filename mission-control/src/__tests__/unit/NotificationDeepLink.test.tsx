/**
 * @jest-environment jsdom
 */

/**
 * A notification about a mission should open that mission.
 *
 * It used to be a plain div: the panel told a learner their run had finished
 * and then left them to find it - back to the feed, scroll, and hope they
 * recognised the name. The thing the notification is about was one tap away
 * the whole time.
 */

import { render, screen, fireEvent } from '@testing-library/react';

import { NotificationModal } from '@/components/layout/NotificationModal';

const COMPLETED = {
  type: 'completed' as const,
  id: 'mission-abc',
  missionName: 'Lunar Mapper',
  completedAt: new Date().toISOString(),
};

function open(props = {}) {
  return render(
    <NotificationModal isOpen onClose={jest.fn()} notifications={[COMPLETED]} {...props} />
  );
}

describe('notifications deep link to their mission', () => {
  it('links a completed run to that mission, not to the feed', () => {
    open();

    const link = screen.getByRole('link', { name: /Lunar Mapper/ });

    expect(link).toHaveAttribute('href', '/missions/mission-abc');
  });

  it('closes the panel on the way, so it is not left over the mission', () => {
    const onClose = jest.fn();
    open({ onClose });

    fireEvent.click(screen.getByRole('link', { name: /Lunar Mapper/ }));

    expect(onClose).toHaveBeenCalled();
  });

  it('dismissing does not also navigate', () => {
    const onDismiss = jest.fn();
    const onClose = jest.fn();
    open({ onDismiss, onClose });

    const dismiss = screen.getByRole('button', { name: /Dismiss notification/ });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(dismiss, event);

    expect(onDismiss).toHaveBeenCalledWith('mission-abc');
    // The row behind the X is a link; letting the click through would dismiss
    // the notification and open the mission at the same time.
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a feed-wide notice unlinked, since its id names no mission', () => {
    render(
      <NotificationModal
        isOpen
        onClose={jest.fn()}
        notifications={[
          { type: 'new-mission', id: 'batch-1', missionName: 'x', message: 'Three new missions' },
        ]}
      />
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
