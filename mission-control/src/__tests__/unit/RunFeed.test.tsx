/**
 * @jest-environment jsdom
 */

/**
 * The mission page's feed: the simulation and every rover video, all on the
 * page at once.
 *
 * David opened a mission with a video on 10 October 2026 and could not find
 * its simulation. The two shared one frame with arrows and the simulation was
 * behind them; before that it was the rover that got missed, behind a
 * dropdown. These pin that nothing chooses between them any more.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const simulatorMounts = jest.fn();
jest.mock('@/components/mission/RoverSimulator', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    RoverSimulator: ({ onFinished }: { onFinished?: () => void }) => {
      // Once per mount, so a remount is something a test can see.
      useEffect(() => {
        simulatorMounts();
      }, []);
      return (
        <button type="button" data-testid="simulator" onClick={onFinished}>
          simulator
        </button>
      );
    },
  };
});

jest.mock('@/components/mission/YouTubeEmbed', () => ({
  YouTubeEmbed: ({ youtubeId, fill }: { youtubeId: string; fill?: boolean }) => (
    <div data-testid="youtube-player" data-fill={fill ? '' : undefined}>
      {youtubeId}
    </div>
  ),
}));

import { RunFeed, moreLabel } from '@/components/mission/RunFeed';
import type { RunOption } from '@/lib/missionRuns';

const run = (id: string, over: Partial<RunOption> = {}): RunOption => ({
  id,
  label: 'Cape Town',
  sublabel: 'Real rover',
  youtubeId: `${id}-video`,
  ...over,
});

function feed(runs: RunOption[], props: Partial<React.ComponentProps<typeof RunFeed>> = {}) {
  return <RunFeed runs={runs} missionName="Sand Observer" trajectory={[]} simDuration="58s" {...props} />;
}

const follows = (first: HTMLElement, second: HTMLElement) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => simulatorMounts.mockClear());

describe('everything there is to watch is on the page', () => {
  it('shows the simulation and every rover video at once, with nothing to step through', () => {
    render(feed([run('b'), run('a')]));

    expect(screen.getByTestId('simulator')).toBeInTheDocument();
    expect(screen.getAllByTestId('youtube-player').map((p) => p.textContent)).toEqual(['b-video', 'a-video']);
    // No arrows, no dots, no tabs: a control that shows one hides the others.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next|previous/i })).not.toBeInTheDocument();
  });

  it('puts the simulation first and the videos after it, newest first', () => {
    render(feed([run('newer'), run('older')]));
    const [newer, older] = screen.getAllByTestId('youtube-player');

    expect(follows(screen.getByTestId('simulator'), newer)).toBe(true);
    expect(follows(newer, older)).toBe(true);
  });

  it('shows the simulation alone for a mission no rover has driven', () => {
    render(feed([]));

    expect(screen.getByTestId('simulator')).toBeInTheDocument();
    expect(screen.queryByTestId('youtube-player')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rover video/i })).not.toBeInTheDocument();
  });
});

describe('each tile says what it is', () => {
  it('names the simulation and how long the program runs', () => {
    render(feed([run('a')]));
    const tile = screen.getByRole('region', { name: /^Simulation/ });

    expect(within(tile).getByRole('heading', { name: 'Simulation' })).toBeInTheDocument();
    expect(within(tile).getByText('58s')).toBeInTheDocument();
  });

  it('names a rover run by where it was driven', () => {
    render(feed([run('a')]));

    expect(screen.getByRole('region', { name: 'Real rover: Cape Town' })).toBeInTheDocument();
  });

  it('numbers the runs in the order they were driven when there are several', () => {
    // Two tiles both reading "Real rover, Cape Town" say nothing about which
    // is which.
    render(feed([run('second'), run('first')]));

    const tiles = screen.getAllByRole('region', { name: /^Real rover/ });
    expect(tiles[0]).toHaveAccessibleName('Real rover: Cape Town · run 2 of 2');
    expect(tiles[1]).toHaveAccessibleName('Real rover: Cape Town · run 1 of 2');
  });

  it('says what a run took when the record can be believed, and nothing when it cannot', () => {
    render(
      feed([
        run('good', { startedAt: '2026-10-10T12:00:00Z', completedAt: '2026-10-10T12:00:42Z' }),
        // Left open overnight: 99 hours is paperwork, not a drive.
        run('bad', { startedAt: '2026-10-06T12:00:00Z', completedAt: '2026-10-10T15:00:00Z' }),
      ]),
    );

    const [good, bad] = screen.getAllByRole('region', { name: /^Real rover/ });
    expect(good).toHaveAccessibleName(expect.stringContaining('42s'));
    expect(bad).toHaveAccessibleName('Real rover: Cape Town · run 1 of 2');
  });

  it('links each video to YouTube, and plays a hosted one in place', () => {
    render(feed([run('yt'), run('hosted', { youtubeId: undefined, videoUrl: 'https://storage.example.test/run.mp4' })]));

    expect(screen.getByRole('link', { name: /open this video on youtube/i })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=yt-video',
    );
    expect(screen.getByLabelText('Cape Town rover run video')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /youtube/i })).toHaveLength(1);
  });
});

describe('each picture is its own shape', () => {
  it("has the video fill its 4:3 tile instead of choosing 16:9 for itself", () => {
    render(feed([run('a')]));

    expect(screen.getByTestId('youtube-player')).toHaveAttribute('data-fill');
  });

  it('leaves the shapes to globals.css, which defines every class it uses', () => {
    // The arrangement is CSS, which nothing here can lay out. A class renamed
    // on one side, or a tile no longer shaped from its picture, would leave
    // every other test green.
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
    const rule = (selector: string) => {
      const at = css.search(new RegExp(`^${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{`, 'm'));
      return at === -1 ? null : css.slice(at, css.indexOf('}', at));
    };
    const { container } = render(feed([run('a')]));

    for (const name of ['runFeedWrap', 'runFeed', 'runFeedTile', 'runFeedSim', 'runFeedVideo', 'runFeedRest', 'runFeedMore']) {
      expect(container.querySelector(`.${name}`)).not.toBeNull();
      expect(rule(`.${name}`)).not.toBeNull();
    }
    expect(rule('.runFeedSim')).toMatch(/var\(--yard-aspect\)/);
    expect(rule('.runFeedVideo')).toMatch(/aspect-ratio:\s*4\s*\/\s*3/);
  });

});

describe('a mission driven more than once', () => {
  it('tells the layout so, which then leaves room to show there is a next video', () => {
    const { container, rerender } = render(feed([run('b'), run('a')]));
    expect(container.querySelector('.runFeedWrap')).toHaveAttribute('data-more');

    // One video is all in view beside the simulation: nothing to leave room for.
    rerender(feed([run('a')]));
    expect(container.querySelector('.runFeedWrap')).not.toHaveAttribute('data-more');
  });
});

describe('what the page puts under the videos, in three columns', () => {
  it('comes after every video, inside the feed', () => {
    // The operator's note: it is about the rover's run, so it sits with the
    // rover's videos (the review of 13 October 2026 looked for it there).
    const { container } = render(feed([run('b'), run('a')], { videosFoot: <p data-testid="foot">a note</p> }));
    const foot = screen.getByTestId('foot');
    const videos = screen.getAllByTestId('youtube-player');

    expect(container.querySelector('.runFeed')).toContainElement(foot);
    expect(follows(videos[videos.length - 1], foot)).toBe(true);
    expect(container.querySelector('.runFeedRest')).not.toContainElement(foot);
  });

  it('is not there unless the page hands it one', () => {
    const { container } = render(feed([run('a')]));

    expect(container.querySelector('.runFeedFoot')).toBeNull();
  });

  it('does not restart anything when it arrives, as it does when a window is widened', () => {
    const { rerender } = render(feed([run('a')]));
    const video = screen.getByTestId('youtube-player');

    rerender(feed([run('a')], { videosFoot: <p>a note</p> }));

    expect(simulatorMounts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('youtube-player')).toBe(video);
  });

  it('has its place in globals.css, with the columns it stands in', () => {
    const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');

    expect(css).toMatch(/^\.runFeedFoot \{/m);
    // The two widths lib/missionLayout hands over are the ones the grid reads.
    expect(css).toMatch(/\.missionBody\[data-layout="wide"\] \.runFeed \{[^}]*grid-template-columns:\s*var\(--sim-w\) var\(--videos-w\)/);
  });
});

describe("a phone's code, under the simulation", () => {
  const code = <div data-testid="code">code</div>;

  it('sits between the simulation and the videos', () => {
    render(feed([run('a')], { codeSlot: code }));

    expect(follows(screen.getByTestId('simulator'), screen.getByTestId('code'))).toBe(true);
    expect(follows(screen.getByTestId('code'), screen.getByTestId('youtube-player'))).toBe(true);
  });

  it('folds the videos away while it is open, and keeps the simulation', () => {
    const { container, rerender } = render(feed([run('a')], { codeSlot: code }));
    const videos = container.querySelector('.runFeedRest')!;
    expect(videos).not.toHaveAttribute('aria-hidden');
    expect(container.querySelector('.runFeed')).not.toHaveAttribute('data-code-open');

    rerender(feed([run('a')], { codeSlot: code, codeOpen: true }));

    expect(container.querySelector('.runFeed')).toHaveAttribute('data-code-open');
    expect(videos).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('simulator')).toBeInTheDocument();
  });

  it('does not restart the simulation when the code opens or the videos arrive', () => {
    // A simulator that moved in the tree would remount and play from the top.
    const { rerender } = render(feed([], { codeSlot: code }));
    rerender(feed([run('a')], { codeSlot: code }));
    rerender(feed([run('a')], { codeSlot: code, codeOpen: true }));

    expect(simulatorMounts).toHaveBeenCalledTimes(1);
  });
});

it('tells the page when the simulation has been watched to its end', () => {
  const onSimFinished = jest.fn();
  render(feed([run('a')], { onSimFinished }));

  screen.getByTestId('simulator').click();

  expect(onSimFinished).toHaveBeenCalledTimes(1);
});

describe('the pill that says there is more', () => {
  it('names the videos when none of them is in view yet', () => {
    expect(moreLabel(1, 1)).toBe('Rover video');
    expect(moreLabel(3, 3)).toBe('3 rover videos');
  });

  it('counts only the ones still out of view when some already are in it', () => {
    expect(moreLabel(1, 2)).toBe('1 more video');
    expect(moreLabel(2, 3)).toBe('2 more videos');
  });

  describe('on the page', () => {
    // jsdom lays nothing out, so the tests say where each thing is. The feed
    // is a box 600 tall. `videosBox` is the videos' own: as long as they are
    // in one feed (the default here), or the 400 that shows of them where
    // they scroll in a column of their own.
    let tops: number[] = [];
    let videosBox = { top: 310, height: 5000 };
    const at = (top: number, height: number) =>
      ({ top, left: 0, width: 400, height, bottom: top + height, right: 400, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

    beforeEach(() => {
      videosBox = { top: 310, height: 5000 };
      jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        if (this.classList.contains('runFeed')) return at(0, 600);
        if (this.classList.contains('runFeedRest')) return at(videosBox.top, videosBox.height);
        const videos = [...document.querySelectorAll('.runFeedRest .runFeedTile')];
        const index = videos.indexOf(this);
        return index === -1 ? at(0, 300) : at(tops[index], 300);
      });
    });
    afterEach(() => jest.restoreAllMocks());

    const pill = () => document.querySelector('.runFeedMore')!;
    /** Scrolls the feed to `top`, as far as jsdom can: the position, and the event. */
    const scrollFeed = (top: number) => {
      const feed = document.querySelector('.runFeed')!;
      feed.scrollTop = top;
      fireEvent.scroll(feed);
    };

    it('shows while a video is wholly below the fold, and says how many', async () => {
      tops = [310, 620];
      render(feed([run('b'), run('a')]));

      await waitFor(() => expect(pill()).toHaveAttribute('data-shown'));
      expect(pill()).toHaveTextContent('1 more video');
    });

    it('shows for a video that less than half shows of', async () => {
      // A caption and a strip of sand under the first video say that a video
      // exists. The pill is what says how many, and goes there.
      tops = [150, 480];
      render(feed([run('b'), run('a')]));

      await waitFor(() => expect(pill()).toHaveAttribute('data-shown'));
    });

    it('does not show once most of every video is in view', async () => {
      tops = [310, 430];
      render(feed([run('b'), run('a')]));

      // Give the first measurement its frame, as the test above waits for.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      expect(pill()).not.toHaveAttribute('data-shown');
    });

    it('goes once the learner has scrolled to the last video, and comes back when they scroll back', async () => {
      // It used to go for good at the first scroll. A learner back at the
      // start then had nothing to say there was more (13 October 2026).
      tops = [310, 620];
      render(feed([run('b'), run('a')]));
      await waitFor(() => expect(pill()).toHaveAttribute('data-shown'));

      tops = [-300, 10];
      scrollFeed(610);
      expect(pill()).not.toHaveAttribute('data-shown');
      expect(pill()).toHaveAttribute('aria-hidden', 'true');

      tops = [310, 620];
      scrollFeed(0);
      expect(pill()).toHaveAttribute('data-shown');
    });

    it('goes by what shows of the videos where they scroll in a column of their own', async () => {
      // Three columns: the feed is all in view, and it is the videos' box
      // that cuts them off. A video at 410 is inside the feed's 600 and
      // outside the 400 that shows.
      videosBox = { top: 0, height: 400 };
      tops = [0, 410];
      render(feed([run('b'), run('a')]));

      await waitFor(() => expect(pill()).toHaveAttribute('data-shown'));
    });

    it('hears the videos scroll, which the feed does not when it is theirs to do', async () => {
      videosBox = { top: 0, height: 400 };
      tops = [0, 410];
      render(feed([run('b'), run('a')]));
      await waitFor(() => expect(pill()).toHaveAttribute('data-shown'));

      tops = [-300, 10];
      fireEvent.scroll(document.querySelector('.runFeedRest')!);

      expect(pill()).not.toHaveAttribute('data-shown');
    });

    it('takes the learner to the first video they have not seen', async () => {
      tops = [310, 620, 930];
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      render(feed([run('c'), run('b'), run('a')]));
      await waitFor(() => expect(pill()).toHaveTextContent('2 more videos'));

      fireEvent.click(pill());

      const videos = [...document.querySelectorAll('.runFeedRest .runFeedTile')];
      expect(scrollIntoView.mock.contexts).toEqual([videos[1]]);
    });

    it('keeps its words while it fades, instead of counting down to none', async () => {
      tops = [310, 620];
      render(feed([run('b'), run('a')]));
      await waitFor(() => expect(pill()).toHaveAttribute('data-shown'));

      tops = [-300, 10];
      scrollFeed(610);

      expect(pill()).toHaveTextContent('1 more video');
    });
  });
});
