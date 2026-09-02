/**
 * @jest-environment jsdom
 *
 * Unit tests for the click-to-play YouTube facade.
 *
 * The iframe must not exist until the learner taps play (eager embeds from a
 * shared venue IP trigger YouTube's bot detection), the player must use the
 * privacy-enhanced youtube-nocookie.com domain, and the YouTube fallback
 * escape hatch must always be present since a blocked embed cannot be
 * detected or recovered from inside the iframe.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { YouTubeEmbed } from '@/components/mission/YouTubeEmbed';

const ID = 'dQw4w9WgXcQ';

describe('YouTubeEmbed', () => {
  it('renders the thumbnail facade with no iframe until played', () => {
    const { container } = render(<YouTubeEmbed youtubeId={ID} title="Sand Observer run" />);

    expect(container.querySelector('iframe')).not.toBeInTheDocument();

    const thumb = container.querySelector('img');
    expect(thumb).toHaveAttribute('src', `https://img.youtube.com/vi/${ID}/hqdefault.jpg`);

    expect(screen.getByRole('button', { name: /play video: sand observer run/i })).toBeInTheDocument();
  });

  it('creates the privacy-enhanced iframe with autoplay after tapping play', () => {
    const { container } = render(<YouTubeEmbed youtubeId={ID} title="Sand Observer run" />);

    fireEvent.click(screen.getByRole('button', { name: /play video/i }));

    const iframe = container.querySelector('iframe');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0&autoplay=1&enablejsapi=1`
    );
    // The facade button is gone once the player is live
    expect(screen.queryByRole('button', { name: /play video/i })).not.toBeInTheDocument();
  });

  it('always offers the YouTube fallback in a new tab', () => {
    render(<YouTubeEmbed youtubeId={ID} title="Sand Observer run" />);

    const link = screen.getByRole('link', { name: /open on youtube/i });
    expect(link).toHaveAttribute('href', `https://www.youtube.com/watch?v=${ID}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('can hide the fallback link when a parent surface owns it', () => {
    render(<YouTubeEmbed youtubeId={ID} title="Sand Observer run" showFallbackLink={false} />);

    expect(screen.queryByRole('link', { name: /open on youtube/i })).not.toBeInTheDocument();
  });
});

describe('muting the run video (AB#409)', () => {
  it('starts the player silent when the learner has chosen mute', () => {
    // mute=1 has to be in the URL rather than applied afterwards: the player
    // reads it before any script of ours could reach it, so this is the only
    // thing that prevents a burst of sound before the mute lands.
    const { container } = render(
      <YouTubeEmbed youtubeId={ID} title="Sand Observer run" muted />
    );

    fireEvent.click(screen.getByRole('button', { name: /play video/i }));

    expect(container.querySelector('iframe')).toHaveAttribute(
      'src',
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0&autoplay=1&enablejsapi=1&mute=1`
    );
  });

  it('leaves the URL alone when sound is on, so nothing changes for most learners', () => {
    const { container } = render(<YouTubeEmbed youtubeId={ID} title="Sand Observer run" />);

    fireEvent.click(screen.getByRole('button', { name: /play video/i }));

    expect(container.querySelector('iframe')?.getAttribute('src')).not.toContain('mute=1');
  });

  it('does not touch the src when the choice changes mid-video', () => {
    // Rewriting an iframe's src RELOADS it, so the video would jump back to the
    // start every time somebody reached for the speaker button. Asserting on
    // the element's identity is not enough to catch that: React reuses the same
    // node and simply changes the attribute. The src itself has to hold still,
    // and the live change goes through postMessage instead.
    const { container, rerender } = render(
      <YouTubeEmbed youtubeId={ID} title="Sand Observer run" />
    );

    fireEvent.click(screen.getByRole('button', { name: /play video/i }));
    const before = container.querySelector('iframe')?.getAttribute('src');

    rerender(<YouTubeEmbed youtubeId={ID} title="Sand Observer run" muted />);

    expect(container.querySelector('iframe')?.getAttribute('src')).toBe(before);
    expect(before).not.toContain('mute=1');
  });
});
