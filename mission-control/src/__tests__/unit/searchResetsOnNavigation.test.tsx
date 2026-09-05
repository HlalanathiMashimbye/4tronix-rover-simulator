/**
 * @jest-environment jsdom
 */

/**
 * A search does not follow you to the next page.
 *
 * Reported from a yard: "the filtering stuff when you go from operator to the
 * site, filters don't clear". The controls live in the navbar, so the state
 * lives in a provider above every page, and it used to survive navigation.
 *
 * That is worse than it sounds. Filter KEYS are not shared between pages: the
 * operator console registers 'done' and 'review', which the learner feed has
 * never heard of. Arriving at the feed still holding one left it filtering on
 * a key nothing matches, so the learner saw an empty page - and the chips that
 * would have shown which filter was active had unregistered themselves on the
 * way out, so there was nothing visible to clear.
 */

import { render, screen, fireEvent } from '@testing-library/react';

let pathname = '/operator';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

import { SearchProvider, useSearch, useRegisterSort } from '@/contexts/SearchContext';
import { DEFAULT_MISSION_SORT } from '@/core/domain/services/missionSort';

function Probe() {
  const { query, setQuery, activeFilter, setActiveFilter, sort, setSort } = useSearch();
  useRegisterSort();
  return (
    <div>
      <span data-testid="query">{query || '(empty)'}</span>
      <span data-testid="filter">{activeFilter}</span>
      <span data-testid="sort">{sort}</span>
      <button onClick={() => setQuery('rocky')}>type</button>
      <button onClick={() => setActiveFilter('done')}>pick done</button>
      <button onClick={() => setSort('name-za')}>sort z-a</button>
    </div>
  );
}

/**
 * A fresh element every time, deliberately.
 *
 * Passing the same element object to rerender lets React bail out before it
 * renders anything, so the navigation would never be observed and the test
 * would fail against working code.
 */
const tree = () => (
  <SearchProvider>
    <Probe />
  </SearchProvider>
);

beforeEach(() => {
  pathname = '/operator';
});

describe('leaving a page', () => {
  it('clears the typed query', () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText('type'));
    expect(screen.getByTestId('query')).toHaveTextContent('rocky');

    pathname = '/missions';
    rerender(tree());

    expect(screen.getByTestId('query')).toHaveTextContent('(empty)');
  });

  it('clears a filter the next page has never heard of', () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText('pick done'));
    expect(screen.getByTestId('filter')).toHaveTextContent('done');

    pathname = '/missions';
    rerender(tree());

    // 'all' is the one key every searchable page registers.
    expect(screen.getByTestId('filter')).toHaveTextContent('all');
  });

  it('returns the ordering to the default', () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText('sort z-a'));
    expect(screen.getByTestId('sort')).toHaveTextContent('name-za');

    pathname = '/missions';
    rerender(tree());

    expect(screen.getByTestId('sort')).toHaveTextContent(DEFAULT_MISSION_SORT);
  });
});

describe('staying on a page', () => {
  it('keeps what was typed, so a re-render is not a reset', () => {
    // The reset keys on the path changing, not on rendering. Getting this
    // wrong would clear the box on every keystroke.
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText('type'));

    rerender(tree());

    expect(screen.getByTestId('query')).toHaveTextContent('rocky');
  });
});
