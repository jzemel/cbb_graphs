/**
 * Comedy Bang Bang Universe Explorer
 * ===================================
 *
 * An interactive visualization for exploring 17 years of Comedy Bang Bang podcast data.
 *
 */

// ==========================================================================
// REACT HOOKS SETUP
// ==========================================================================
// Destructure the hooks we need from React.
// These are functions that let us use React features in function components.
const { useState, useMemo, useCallback, useEffect } = React;


// ==========================================================================
// CONSTANTS
// ==========================================================================

// Episode cell colors
const EPISODE_DEFAULT_COLOR = 'hsl(210, 50%, 60%)';     // Blue for regular episodes
const EPISODE_LIVE_COLOR = '#EE6C4D';                   // Coral/orange for live episodes
const EPISODE_HIGHLIGHT_COLOR = 'hsl(45, 100%, 51%)';  // Bright amber for selected entity
const EPISODE_HOVER_COLOR = '#004777';                  // Dark blue for hover fill
const ENTITY_HOVER_COLOR = 'hsl(45, 100%, 51%)';       // Bright amber for entity hover

// Episode cell outline/stroke
const HOVER_OUTLINE_WIDTH = '3px';                      // Outline width when hovering
const HOVER_OUTLINE_COLOR = 'hsl(45, 100%, 51%)';      // Bright amber for hover outline
const PINNED_OUTLINE_WIDTH = '3px';                     // Outline width when pinned
const PINNED_OUTLINE_COLOR = 'hsl(38, 92%, 50%)';      // Darker amber for pinned outline


// ==========================================================================
// UTILITY FUNCTIONS
// ==========================================================================
// These are helper functions used throughout the app.
// They're defined outside components so they don't get recreated on each render.

/**
 * Generates a color based on how recently an entity appeared.
 * Uses HSL color space for smooth gradients.
 *
 * @param {number} ratio - 0 = oldest appearance, 1 = most recent
 * @returns {string} CSS HSL color string
 *
 * The hue goes from 280 (purple) to 120 (green):
 * - Purple = appeared long ago
 * - Blue = median recency
 * - Green = appeared recently
 */
const getRecencyColor = (ratio) => {
  // Apply power curve to spread out recent appearances
  const adjusted = Math.pow(ratio, 4);
  const hue = 280 - adjusted * 160;  // 280 = purple, 120 = green
  return `hsl(${hue}, 70%, 50%)`;
};

/**
 * Generate a Fandom wiki URL for an entity (guest, character, or episode).
 * Replaces spaces with underscores as per wiki URL conventions.
 *
 * @param {string} name - The entity name
 * @returns {string} Full Fandom wiki URL
 */
const getWikiUrl = (name) => {
  const encoded = encodeURIComponent(name.replace(/ /g, '_'));
  return `https://comedybangbang.fandom.com/wiki/${encoded}`;
};

/**
 * Generate an Earwolf episode URL.
 * Converts episode title to URL slug (lowercase, spaces to hyphens, remove special chars).
 *
 * @param {string} title - The episode title
 * @returns {string} Full Earwolf episode URL
 */
const getEarwolfUrl = (title) => {
  const slug = title
    .toLowerCase()
    .replace(/['']/g, '')           // Remove apostrophes
    .replace(/[^a-z0-9\s-]/g, '')   // Remove special characters
    .replace(/\s+/g, '-')           // Spaces to hyphens
    .replace(/-+/g, '-')            // Collapse multiple hyphens
    .replace(/^-|-$/g, '');         // Trim leading/trailing hyphens
  return `https://www.earwolf.com/episode/${slug}/`;
};

/**
 * Check if an episode is a live/tour episode.
 * Live episodes either:
 * 1. Have non-numeric episode numbers like "from the road", or
 * 2. Have "live" as a standalone word in the title (not "alive", "liven", etc.)
 *
 * @param {Object} episode - Episode object with 'n' (number) and 't' (title) fields
 * @returns {boolean} True if live/tour episode
 */
const isLiveEpisode = (episode) => {
  const num = episode.number || episode.n;
  const title = episode.title || episode.t || '';

  // Check 1: Non-numeric episode number (e.g., "from the road", "BO2013.1")
  const hasNonNumericNumber = num && !/^[0-9]+(\.[0-9]+)?$/.test(num);

  // Check 2: Title contains "live" as a standalone word
  // Use word boundary \b to match "live" but not "alive", "liven", "deliver", etc.
  const hasLiveInTitle = /\blive\b/i.test(title);

  return hasNonNumericNumber || hasLiveInTitle;
};

/**
 * Get the base color for an episode cell based on the number of guests.
 * Uses a blue color scale where intensity increases with more guests.
 *
 * @param {number} guestCount - Number of guests in the episode
 * @param {number} maxGuests - Maximum guests across all episodes
 * @returns {string} CSS HSL color string
 */
const getEpisodeBaseColor = (guestCount, maxGuests) => {
  if (maxGuests === 0) return 'hsl(210, 50%, 60%)';

  // Map guest count to lightness: fewer guests = lighter, more guests = darker
  // Range: 85% (lightest) to 45% (darkest)
  const ratio = guestCount / maxGuests;
  const lightness = 85 - (ratio * 40);

  return `hsl(210, 50%, ${lightness}%)`;
};


// ==========================================================================
// DATA LOADING & PROCESSING
// ==========================================================================

/**
 * Transforms the raw JSON data into a format optimized for the visualization.
 * This function:
 * 1. Expands abbreviated keys (t -> title, d -> date, etc.)
 * 2. Parses date strings into Date objects
 * 3. Builds lookup maps for guests and characters
 * 4. Groups episodes by year for the timeline
 *
 * @param {Object} raw - The raw data from cbb_data.js
 * @returns {Object} Processed data with episodes, maps, and metadata
 */
// TODO goes through every episode at least 3x, can trim that if needed.
const loadData = (raw) => {
  if (!raw) return null;

  /**
   * Safely parse a date string into a Date object.
   * Returns null if the date is invalid.
   */
  const parseDate = (s) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  /**
   * Calculate which week of the year a date falls in (0-52).
   * Used to position episodes in the timeline grid.
   *
   * 604800000 = milliseconds in a week (7 * 24 * 60 * 60 * 1000)
   */
  const getWeekOfYear = (date) => {
    const start = new Date(date.getFullYear(), 0, 1);  // Jan 1 of that year
    const diff = date - start;
    return Math.floor(diff / 604800000);
  };

  // Transform each episode from abbreviated format to full format
  const episodes = raw.episodes
    .map(e => ({
      title: e.t,
      number: e.n,
      date: parseDate(e.d),
      guests: e.g || [],
      characters: e.c || [],
      imageUrl: e.i || null,  // Episode image URL
    }))
    .filter(e => e.date)  // Remove episodes with invalid dates
    .sort((a, b) => a.date - b.date);  // Sort chronologically

  // Add computed properties to each episode
  episodes.forEach((ep, idx) => {
    ep.idx = idx;                        // Position in sorted array
    ep.year = ep.date.getFullYear();     // Year for grouping
    ep.week = getWeekOfYear(ep.date);    // Week for timeline positioning
    ep.num_characters = ep.characters.length; // # Characs for visualizing
    ep.num_guests = ep.guests.length; // # Guests for visualizing
    ep.characters_per_guest = ep.characters.length / ep.guests.length; // # Characs per Guest
  });

  // Build lookup maps for guests and characters
  // Maps provide O(1) lookup by name, much faster than searching arrays
  // TODO seems wastefull to run through O(N) again, does this impact performance?
  const guestMap = new Map();
  const characterMap = new Map();

  // Process each episode to build the lookup maps
  episodes.forEach((ep, idx) => {
    // Process guests
    ep.guests.forEach(g => {
      if (!guestMap.has(g)) {
        // First time seeing this guest - create their entry
        guestMap.set(g, {
          name: g,
          episodes: [],   // Will hold indices of all their episodes
          firstIdx: idx,  // Index of first appearance
          lastIdx: idx    // Index of last appearance (updated below)
        });
      }
      const gData = guestMap.get(g);
      gData.episodes.push(idx);
      gData.lastIdx = idx;  // Update last appearance
    });

    // Process characters (similar to guests, but also tracks who plays them)
    ep.characters.forEach(c => {
      if (!characterMap.has(c)) {
        characterMap.set(c, {
          name: c,
          episodes: [],
          firstIdx: idx,
          lastIdx: idx,
          guests: new Set()  // Track all guests who have played this character
        });
      }
      const cData = characterMap.get(c);
      cData.episodes.push(idx);
      cData.lastIdx = idx;
      // Associate this character with all guests in the episode
      // TODO this is a squishy assignment of guest-character, should fix at some point?
      ep.guests.forEach(g => cData.guests.add(g));
    });
  });

  // Group episodes by year for the timeline visualization
  // TODO another O(N). Will see if timing matters here.
  const episodesByYear = new Map();
  episodes.forEach(ep => {
    if (!episodesByYear.has(ep.year)) {
      episodesByYear.set(ep.year, []);
    }
    episodesByYear.get(ep.year).push(ep);
  });

  // Get sorted list of years for timeline rows
  const years = Array.from(episodesByYear.keys()).sort();

  // Guest-to-character mapping from the data file
  const guestCharacters = raw.guestCharacters || {};

  // Image URL lookups for guests and characters
  const guestImages = raw.guestImages || {};
  const characterImages = raw.characterImages || {};

  // Add image URLs to guest and character maps
  guestMap.forEach((guest, name) => {
    guest.imageUrl = guestImages[name] || null;
  });
  characterMap.forEach((char, name) => {
    char.imageUrl = characterImages[name] || null;
  });

  // Calculate max values for color scaling
  // Do this once at load time instead of recalculating on every render
  const stats = {
    maxEpisodesWithLive: 0,
    maxEpisodesWithoutLive: 0,
    maxGuests: 0,
    maxCharacters: 0,
    maxCharactersPerGuest: 0
  };

  episodesByYear.forEach((yearEps) => {
    stats.maxEpisodesWithLive = Math.max(stats.maxEpisodesWithLive, yearEps.length);
    const withoutLive = yearEps.filter(ep => !isLiveEpisode(ep)).length;
    stats.maxEpisodesWithoutLive = Math.max(stats.maxEpisodesWithoutLive, withoutLive);
  });

  // Calculate max guests, characters, and characters per guest across all episodes
  episodes.forEach(ep => {
    stats.maxGuests = Math.max(stats.maxGuests, ep.num_guests);
    stats.maxCharacters = Math.max(stats.maxCharacters, ep.num_characters);
    if (ep.num_guests > 0) {
      stats.maxCharactersPerGuest = Math.max(stats.maxCharactersPerGuest, ep.characters_per_guest);
    }
  });

  return {
    episodes,
    guestMap,
    characterMap,
    guestCharacters,
    guestImages,
    characterImages,
    episodesByYear,
    years,
    stats
  };
};


// ==========================================================================
// MAIN APP COMPONENT
// ==========================================================================

/**
 * The root component that contains all the application state and UI.
 *
 * It holds the main state and renders child components.
 */
function App() {
  // ------------------------------------------------------------------------
  // STATE DECLARATIONS
  // ------------------------------------------------------------------------
  // useState creates a piece of state and a function to update it.
  // When state changes, React automatically re-renders the component.

  // The raw data from cbb_data.js
  const [rawData] = useState(CBB_DATA);

  // Process the raw data using useMemo (only recomputes when rawData changes)
  const data = useMemo(() => loadData(rawData), [rawData]);

  // Currently selected guest or character name (or null if none selected)
  const [selectedEntity, setSelectedEntity] = useState(null);

  // Whether we're viewing 'guest' or 'character' mode
  const [entityType, setEntityType] = useState('guest');

  // Index of the episode being hovered (for tooltip), null if none
  const [hoveredEpisode, setHoveredEpisode] = useState(null);

  // Index of the episode that was clicked (pinned), null if none
  // When pinned, the episode summary stays visible even when not hovering
  const [pinnedEpisode, setPinnedEpisode] = useState(null);

  // How to sort the entity list: 'appearances', 'first', 'last', or 'name'
  const [sortBy, setSortBy] = useState('appearances');

  // Timeline container ref for measuring width
  const timelineContainerRef = React.useRef(null);

  // Size of each cell in the timeline grid (in pixels)
  const [cellSize, setCellSize] = useState(11);

  // Whether to include live episodes in the timeline
  const [includeLiveEps, setIncludeLiveEps] = useState(false);

  // Color mode for episode cells: 'guests', 'characters', or 'chars-per-guest'
  const [colorMode, setColorMode] = useState('guests');

  // Simple: just pick the pre-calculated max based on checkbox state
  const maxEpisodesInYear = includeLiveEps
    ? data?.stats?.maxEpisodesWithLive || 0
    : data?.stats?.maxEpisodesWithoutLive || 0;

  // Debug: Check if checkbox state is changing
  console.log('=== State Update ===');
  console.log('includeLiveEps:', includeLiveEps);
  console.log('maxEpisodesInYear:', maxEpisodesInYear);
  console.log('stats:', data?.stats);

  // Auto-size cells to fill container width
  useEffect(() => {
    console.log("use effect running");
    const container = timelineContainerRef.current;
    if (!container || !maxEpisodesInYear) return;

    const updateCellSize = () => {
      const containerWidth = container.clientWidth;

      // Guard: Don't update if container isn't rendered yet
      if (containerWidth === 0) {
        console.log('containerWidth is 0, skipping update');
        return;
      }

      const padding = 32;           // p-4 = 16px on each side
      const yearLabelWidth = 40;    // w-12 (48px) + ~2px spacing
      const countLabelWidth = 30;   // w-14 (56px) + ~2px spacing
      const gap = 1;                // Fixed gap between cells

      const availableWidth = containerWidth - padding - yearLabelWidth - countLabelWidth;

      // Calculate cell size with decimal precision (no rounding!)
      const size = (availableWidth - (maxEpisodesInYear - 1) * gap) / maxEpisodesInYear;

      // Debug: Show calculation details
      console.log('=== Cell Size Calculation ===');
      console.log('containerWidth:', containerWidth);
      console.log('maxEpisodesInYear:', maxEpisodesInYear);
      console.log('availableWidth:', availableWidth);
      console.log('calculated size:', size);
      console.log('total used:', (size * maxEpisodesInYear) + ((maxEpisodesInYear - 1) * gap));
      console.log('size change:', size > cellSize ? 'LARGER' : size < cellSize ? 'smaller' : 'same');

      // Only update if size is valid (minimum 4px) and different from current
      if (size >= 4 && Math.abs(size - cellSize) > 0.1) {
        setCellSize(size);
        console.log("set cell size to", size);
      } else if (size < 4) {
        console.log('calculated size too small, keeping current cellSize');
      }
    };

    // Call immediately when maxEpisodes changes
    updateCellSize();

    const resizeObserver = new ResizeObserver(updateCellSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [includeLiveEps, maxEpisodesInYear]); // Re-run when checkbox toggles or max changes

  // Search query for filtering entities
  const [searchQuery, setSearchQuery] = useState('');

  // Entity being hovered (for live episode highlighting)
  // Format: { name: string, type: 'guest' | 'character' } or null
  const [hoveredEntity, setHoveredEntity] = useState(null);

  // Debounced hover state for episode summary (prevents excessive re-renders)
  const hoverTimeoutRef = React.useRef(null);
  const setHoveredEpisodeDebounced = useCallback((idx) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredEpisode(idx);
    }, 50); // Small delay to batch rapid hover changes
  }, []);


  // Check if data is available
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <h1 className="text-2xl font-bold mb-4">Comedy Bang Bang Universe</h1>
          <p className="text-gray-600">Error loading data. Make sure cbb_data.js is included.</p>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------------
  // DESTRUCTURE DATA
  // ------------------------------------------------------------------------
  // Pull out the pieces we need from the processed data
  const { episodes, guestMap, characterMap, guestCharacters, episodesByYear, years } = data;

  // ------------------------------------------------------------------------
  // COMPUTED VALUES (useMemo)
  // ------------------------------------------------------------------------

  /**
   * Get the sorted and filtered list of entities (guests or characters).
   * useMemo ensures this only recalculates when dependencies change.
   */
  const sortedEntities = useMemo(() => {
    // Choose which map to use based on entity type
    const map = entityType === 'guest' ? guestMap : characterMap;
    let entities = Array.from(map.values());

    // Filter by search query if present
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      entities = entities.filter(e => e.name.toLowerCase().includes(q));
    }

    // Sort based on selected sort mode
    switch (sortBy) {
      case 'appearances':
        return entities.sort((a, b) => b.episodes.length - a.episodes.length);
      case 'first':
        return entities.sort((a, b) => a.firstIdx - b.firstIdx);
      case 'last':
        return entities.sort((a, b) => b.lastIdx - a.lastIdx);
      case 'name':
        return entities.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return entities;
    }
  }, [guestMap, characterMap, entityType, sortBy, searchQuery]);

  // Get the right lookup map for the current entity type
  const entityLookup = entityType === 'guest' ? guestMap : characterMap;

  /**
   * Check if an episode features the currently selected entity.
   * useCallback caches this function so it doesn't get recreated on every render.
   */
  const episodeHasEntity = useCallback((ep) => {
    if (!selectedEntity) return false;
    return entityType === 'guest'
      ? ep.guests.includes(selectedEntity)
      : ep.characters.includes(selectedEntity);
  }, [selectedEntity, entityType]);

  // Month labels and their approximate starting weeks (for timeline header)
  const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const monthWeeks = [0, 4, 8, 13, 17, 22, 26, 30, 35, 39, 44, 48];


  // ========================================================================
  // TIMELINE COMPONENT
  // ========================================================================
  /**
   * Renders a sequential episode timeline.
   * Each row is a year, each cell is one episode (no overlapping).
   * Episodes are laid out left-to-right in chronological order.
   *
   * This is defined inside App() so it has access to App's state and data.
   * In a larger app, you might move this to a separate file and pass props.
   */
  const Timeline = () => {
    return (
      <div className="space-y-0.5">
        {/* One row per year */}
        {years.map(year => {
          const yearEps = episodesByYear.get(year) || [];

          // Filter out live episodes if checkbox is unchecked
          const filteredYearEps = includeLiveEps
            ? yearEps
            : yearEps.filter(ep => !isLiveEpisode(ep));

          // Count how many episodes feature the selected entity
          const highlightedCount = filteredYearEps.filter(episodeHasEntity).length;

          return (
            <div key={year} className="flex items-center">
              {/* Year label */}
              <div className="w-12 shrink-0 text-xs font-bold text-gray-500 pr-2 text-right">
                {year}
              </div>

              {/* Episode cells - one per episode, sequential */}
              <div
                className="flex"
                style={{ gap: 1 }}
                onMouseLeave={() => {
                  // Clear any pending debounced hover and immediately clear state
                  if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current);
                  }
                  setHoveredEpisode(null);
                }}
              >
                {filteredYearEps.map((ep) => {
                  const hasHighlight = episodeHasEntity(ep);
                  const isPinned = ep.idx === pinnedEpisode;

                  // Check if this episode contains the hovered entity
                  const hasHoveredEntity = hoveredEntity && (
                    (hoveredEntity.type === 'guest' && ep.guests.includes(hoveredEntity.name)) ||
                    (hoveredEntity.type === 'character' && ep.characters.includes(hoveredEntity.name))
                  );

                  // Determine cell background color based on state
                  let bgColor;
                  if (hasHoveredEntity) {
                    bgColor = ENTITY_HOVER_COLOR;
                  } else if (hasHighlight) {
                    bgColor = EPISODE_HIGHLIGHT_COLOR;
                  } else if (isLiveEpisode(ep)) {
                    bgColor = EPISODE_LIVE_COLOR;
                  } else {
                    // Base color scaled by selected metric
                    switch (colorMode) {
                      case 'characters':
                        bgColor = getEpisodeBaseColor(ep.num_characters, data.stats.maxCharacters);
                        break;
                      case 'chars-per-guest':
                        bgColor = getEpisodeBaseColor(ep.characters_per_guest, data.stats.maxCharactersPerGuest);
                        break;
                      default: // 'guests'
                        bgColor = getEpisodeBaseColor(ep.num_guests, data.stats.maxGuests);
                    }
                  }

                  // Pinned state uses special styling
                  const pinnedStyles = isPinned
                    ? { backgroundColor: 'hsl(38,92%,50%)', outline: '3px solid hsl(38,92%,50%)' }
                    : {};

                  return (
                    <div
                      key={ep.idx}
                      data-timeline-cell
                      className={`rounded-sm cursor-pointer ${
                        isPinned
                          ? 'z-10'
                          : '[background:var(--cell-bg)] hover:bg-[#004777] hover:outline hover:outline-[3px] hover:outline-[hsl(45,100%,51%)] hover:z-10'
                      }`}
                      style={{
                        '--cell-bg': bgColor,
                        width: cellSize,
                        height: cellSize,
                        ...pinnedStyles
                      }}
                      onMouseEnter={() => setHoveredEpisodeDebounced(ep.idx)}
                      onClick={() => {
                        // Toggle pin: if already pinned to this episode, unpin; otherwise pin
                        setPinnedEpisode(pinnedEpisode === ep.idx ? null : ep.idx);
                      }}
                    />
                  );
                })}
              </div>

              {/* Episode count for this year */}
              <div className="w-14 shrink-0 text-xs text-gray-500 pl-2 font-mono">
                {highlightedCount > 0 ? (
                  <span className="text-amber-600 font-bold">
                    {highlightedCount}
                    <span className="text-gray-400">/{filteredYearEps.length}</span>
                  </span>
                ) : (
                  <span className="text-gray-400">{filteredYearEps.length}</span>
                )}
              </div>
            </div>
          );
        })}

      </div>
    );
  };


  // ========================================================================
  // EPISODE SUMMARY COMPONENT
  // ========================================================================
  /**
   * Shows episode details below the timeline.
   * Displays when hovering over a cell OR when an episode is pinned (clicked).
   * Pinned episodes take priority over hovered episodes.
   * Guest and character names are clickable to select them.
   */
  const EpisodeSummary = () => {
    // Determine which episode to show: pinned takes priority over hovered
    const displayEpisodeIdx = pinnedEpisode !== null ? pinnedEpisode : hoveredEpisode;

    // Show placeholder if no episode selected
    if (displayEpisodeIdx === null) {
      return (
        <div className="mt-4 pt-4 border-t border-gray-100" data-episode-summary>
          <div className="text-gray-400 text-center py-4 text-sm">
            Hover over a cell to see episode details. Click to pin.
          </div>
        </div>
      );
    }

    const ep = episodes[displayEpisodeIdx];
    const isPinned = pinnedEpisode !== null;

    return (
      <div className="mt-4 pt-4 border-t border-gray-100" data-episode-summary>
        {/* Episode header with optional image */}
        <div className="flex gap-4 mb-3">
          {/* Episode image (if available) - clickable link to wiki */}
          {ep.imageUrl && (
            <a
              href={getWikiUrl(ep.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 hover:opacity-80 transition-opacity"
            >
              <img
                src={ep.imageUrl}
                alt={ep.title}
                className="w-24 h-24 rounded-lg object-cover"
                referrerPolicy="no-referrer"
                onError={(e) => { e.target.parentElement.style.display = 'none'; }}
              />
            </a>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                <a
                  href={getWikiUrl(ep.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-600 transition-colors"
                >
                  <div className="font-semibold text-gray-900">{ep.title}</div>
                </a>
                <div className="text-gray-500 text-sm">
                  #{ep.number} • {ep.date.toLocaleDateString()}
                </div>
                {/* Listen on Earwolf link */}
                <a
                  href={getEarwolfUrl(ep.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 mt-1"
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                  </svg>
                  Listen on Earwolf
                </a>
              </div>
              {/* Show pin indicator and close button when pinned */}
              {isPinned && (
                <button
                  onClick={() => setPinnedEpisode(null)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                  title="Unpin episode"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Guests and Characters in two columns */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {/* Guests column */}
          <div>
            <div className="text-blue-600 font-medium mb-2 text-xs uppercase tracking-wide">Guests</div>
            <div
              className="flex flex-wrap gap-1"
              onMouseLeave={() => setHoveredEntity(null)}
            >
              {ep.guests.length ? ep.guests.map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    setEntityType('guest');
                    setSelectedEntity(g);
                  }}
                  onMouseEnter={() => setHoveredEntity({ name: g, type: 'guest' })}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    g === selectedEntity
                      ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-400'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {g}
                </button>
              )) : <span className="text-gray-400 text-xs">None</span>}
            </div>
          </div>

          {/* Characters column */}
          <div>
            <div className="text-emerald-600 font-medium mb-2 text-xs uppercase tracking-wide">Characters</div>
            <div
              className="flex flex-wrap gap-1"
              onMouseLeave={() => setHoveredEntity(null)}
            >
              {ep.characters.length ? ep.characters.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setEntityType('character');
                    setSelectedEntity(c);
                  }}
                  onMouseEnter={() => setHoveredEntity({ name: c, type: 'character' })}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    c === selectedEntity
                      ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-400'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  {c}
                </button>
              )) : <span className="text-gray-400 text-xs">None</span>}
            </div>
          </div>
        </div>
      </div>
    );
  };


  // ========================================================================
  // ENTITY LIST COMPONENT
  // ========================================================================
  /**
   * Renders the scrollable list of guests or characters.
   * Each item shows:
   * - Recency dot (colored purple→green based on last appearance)
   * - Name
   * - Frequency bar
   * - Appearance count
   *
   * Scroll container is kept outside memoized content to preserve scroll position.
   */
  const EntityListItems = React.memo(({ entities, selected, type, onSelect, onHover }) => (
    <>
      {entities.map((entity) => {
        const isSelected = selected === entity.name;
        const recencyRatio = entity.lastIdx / (episodes.length - 1);
        const barWidth = (entity.episodes.length / (entities[0]?.episodes.length || 1)) * 100;

        return (
          <div
            key={entity.name}
            onClick={() => onSelect(isSelected ? null : entity.name)}
            onMouseEnter={() => onHover({ name: entity.name, type })}
            className={`px-2 py-1 rounded cursor-pointer flex items-center gap-2 ${
              isSelected ? 'bg-amber-100 ring-1 ring-amber-400' : 'hover:bg-gray-100'
            }`}
          >
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: getRecencyColor(recencyRatio) }}
            />
            <div className="flex-1 text-xs font-medium truncate">
              {entity.name}
            </div>
            <div className="w-10 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 w-5 text-right">
              {entity.episodes.length}
            </div>
          </div>
        );
      })}
    </>
  ));



  // ========================================================================
  // ENTITY DETAIL COMPONENT
  // ========================================================================
  /**
   * Shows detailed information about the selected guest or character:
   * - First and last appearance
   * - Year-by-year bar chart
   * - Related entities (guest's characters or character's players)
   */
  const EntityDetail = () => {
    // Show placeholder if nothing selected
    if (!selectedEntity) {
      return (
        <div className="text-gray-400 text-center py-6 text-sm">
          Select a {entityType} to see details
        </div>
      );
    }

    const entity = entityLookup.get(selectedEntity);
    if (!entity) return null;

    const firstEp = episodes[entity.firstIdx];
    const lastEp = episodes[entity.lastIdx];

    // Count appearances per year for the bar chart
    const yearCounts = new Map();
    entity.episodes.forEach(idx => {
      const year = episodes[idx].year;
      yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
    });
    const maxYearCount = Math.max(...Array.from(yearCounts.values()));

    // Build list of related entities
    const related = [];
    if (entityType === 'guest' && guestCharacters[selectedEntity]) {
      // For guests: show characters they play
      guestCharacters[selectedEntity].forEach(c => {
        const charData = characterMap.get(c);
        if (charData) {
          related.push({ name: c, count: charData.episodes.length, type: 'character' });
        }
      });
    } else if (entityType === 'character' && entity.guests) {
      // For characters: show guests who play them
      entity.guests.forEach(g => {
        related.push({
          name: g,
          count: guestMap.get(g)?.episodes.length || 0,
          type: 'guest'
        });
      });
    }
    related.sort((a, b) => b.count - a.count);

    return (
      <div className="space-y-3">
        {/* Header with name, count, and optional image - links to Fandom wiki */}
        <div className="flex gap-3">
          {/* Image thumbnail (if available) - clickable link to wiki */}
          {entity.imageUrl && (
            <a
              href={getWikiUrl(selectedEntity)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 hover:opacity-80 transition-opacity"
            >
              <img
                src={entity.imageUrl}
                alt={entity.name}
                className="w-16 h-16 rounded-lg object-cover"
                referrerPolicy="no-referrer"
                onError={(e) => { e.target.parentElement.style.display = 'none'; }}
              />
            </a>
          )}
          <div className="flex-1 min-w-0">
            <a
              href={getWikiUrl(selectedEntity)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-600 transition-colors"
            >
              <h3 className="font-bold truncate">{selectedEntity}</h3>
            </a>
            <div className="text-sm text-gray-500">
              {entity.episodes.length} appearances
            </div>
          </div>
        </div>

        {/* First/Last appearance cards */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div
            className="bg-gray-50 hover:bg-amber-50 rounded p-2 cursor-pointer transition-colors"
            onMouseEnter={() => setHoveredEpisode(entity.firstIdx)}
            onMouseLeave={() => setHoveredEpisode(null)}
            onClick={() => setPinnedEpisode(pinnedEpisode === entity.firstIdx ? null : entity.firstIdx)}
          >
            <div className="text-gray-400">First</div>
            <div className="font-medium truncate text-amber-700 hover:text-amber-800">{firstEp.title}</div>
            <div className="text-gray-400">{firstEp.date.getFullYear()}</div>
          </div>
          <div
            className="bg-gray-50 hover:bg-amber-50 rounded p-2 cursor-pointer transition-colors"
            onMouseEnter={() => setHoveredEpisode(entity.lastIdx)}
            onMouseLeave={() => setHoveredEpisode(null)}
            onClick={() => setPinnedEpisode(pinnedEpisode === entity.lastIdx ? null : entity.lastIdx)}
          >
            <div className="text-gray-400">Latest</div>
            <div className="font-medium truncate text-amber-700 hover:text-amber-800">{lastEp.title}</div>
            <div className="text-gray-400">{lastEp.date.getFullYear()}</div>
          </div>
        </div>

        {/* Year-by-year bar chart */}
        <div>
          <div className="text-xs text-gray-400 mb-1">By year</div>
          <div className="flex items-end gap-px h-8">
            {years.map(year => {
              const count = yearCounts.get(year) || 0;
              // Height as percentage, minimum 15% if there's at least one appearance
              const height = count ? Math.max(15, (count / maxYearCount) * 100) : 0;
              return (
                <div key={year} className="flex-1 flex flex-col justify-end h-full">
                  {count > 0 && (
                    <div
                      className="w-full bg-amber-400 rounded-t"
                      style={{ height: `${height}%` }}
                      title={`${year}: ${count}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{years[0]}</span>
            <span>{years[years.length - 1]}</span>
          </div>
        </div>

        {/* Related entities */}
        {related.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">
              {entityType === 'guest' ? 'Known characters' : 'Played by'}
            </div>
            <div
              className="flex flex-wrap gap-1"
              onMouseLeave={() => setHoveredEntity(null)}
            >
              {related.slice(0, 6).map(r => (
                <button
                  key={r.name}
                  onClick={() => {
                    setEntityType(r.type);
                    setSelectedEntity(r.name);
                  }}
                  onMouseEnter={() => setHoveredEntity({ name: r.name, type: r.type })}
                  className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs"
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };


  // ========================================================================
  // CLICK OUTSIDE HANDLER
  // ========================================================================
  /**
   * When an episode is pinned, clicking anywhere outside the episode summary
   * should unpin it. We handle this at the top level of the app.
   */
  const handleBackgroundClick = (e) => {
    // Only unpin if something is pinned
    if (pinnedEpisode === null) return;

    // Check if click was inside the episode summary area (don't unpin for those clicks)
    const episodeSummary = e.target.closest('[data-episode-summary]');
    if (episodeSummary) return;

    // Check if click was on a timeline cell (those handle their own pinning)
    const timelineCell = e.target.closest('[data-timeline-cell]');
    if (timelineCell) return;

    // Unpin the episode
    setPinnedEpisode(null);
  };

  // ========================================================================
  // MAIN RENDER
  // ========================================================================
  /**
   * The main UI layout. Uses CSS Grid for the responsive layout.
   * - Left: Timeline (spans 2 columns on large screens)
   * - Right: Entity browser and detail panel
   * - Bottom: Legend
   */
  return (
    <div className="min-h-screen bg-gray-50 p-3" onClick={handleBackgroundClick}>
      <div className="max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-gray-900">Comedy Bang Bang Universe</h1>
          <p className="text-gray-500 text-xs">
            {episodes.length} episodes • {guestMap.size} guests • {characterMap.size} characters • {years[0]}–{years[years.length-1]}
          </p>
        </div>

        {/* Main flex layout */}
        <div className="flex gap-4">
          {/* Timeline panel - expands to fill space */}
          <div ref={timelineContainerRef} className="flex-1 min-w-[600px] bg-white rounded-xl p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-gray-800 text-sm">Episode Timeline</h2>
                <p className="text-xs text-gray-400">
                  Each cell = one episode. Select a guest or character to highlight.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {/* Color mode dropdown */}
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <span>Color by:</span>
                  <select
                    value={colorMode}
                    onChange={(e) => setColorMode(e.target.value)}
                    className="text-xs border border-gray-300 rounded px-2 py-1 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="guests">Guests</option>
                    <option value="characters">Characters</option>
                    <option value="chars-per-guest">Chars/Guest</option>
                  </select>
                </label>
                {/* Filter checkbox for live episodes */}
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeLiveEps}
                    onChange={(e) => setIncludeLiveEps(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex items-center gap-1">
                    Include live eps
                    {includeLiveEps && (
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: EPISODE_LIVE_COLOR }}
                      />
                    )}
                  </span>
                </label>
              </div>
            </div>
            <Timeline />
            <EpisodeSummary />
          </div>

          {/* Right sidebar - fixed width */}
          <div className="w-80 shrink-0 flex flex-col gap-3 max-h-[calc(100vh-120px)]">
            {/* Entity browser */}
            <div className="bg-white rounded-xl p-3 shadow-sm flex-shrink-0">
              {/* Guest/Character toggle */}
              <div className="flex gap-1 mb-2">
                {['guest', 'character'].map(t => (
                  <button
                    key={t}
                    onClick={() => {
                      setEntityType(t);
                      setSelectedEntity(null);
                      setSearchQuery('');
                    }}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium ${
                      entityType === t
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t === 'guest' ? 'Guests' : 'Characters'}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <input
                type="text"
                placeholder={`Search ${entityType}s...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border rounded-lg mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />

              {/* Sort buttons */}
              <div className="flex gap-1 mb-2">
                {[
                  { k: 'appearances', l: 'Most' },
                  { k: 'last', l: 'Recent' },
                  { k: 'first', l: 'OG' },
                  { k: 'name', l: 'A–Z' }
                ].map(s => (
                  <button
                    key={s.k}
                    onClick={() => setSortBy(s.k)}
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      sortBy === s.k
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-400 hover:bg-gray-100'
                    }`}
                  >
                    {s.l}
                  </button>
                ))}
              </div>

              {/* Scroll container inline to preserve scroll position across re-renders */}
              <div
                className="space-y-0.5 max-h-[40vh] overflow-y-auto scrollbar-thin pr-1"
                onMouseLeave={() => setHoveredEntity(null)}
              >
                <EntityListItems
                  entities={sortedEntities.slice(0, 100)}
                  selected={selectedEntity}
                  type={entityType}
                  onSelect={setSelectedEntity}
                  onHover={setHoveredEntity}
                />
              </div>
            </div>

            {/* Detail panel */}
            <div className="bg-white rounded-xl p-3 shadow-sm flex-1 overflow-y-auto min-h-0">
              <EntityDetail />
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 bg-white rounded-lg p-3 shadow-sm">
          <div className="flex justify-between items-center text-xs">
            {/* Color scale legend - changes based on selected mode */}
            <div className="flex items-center gap-1">
              <div className="flex gap-0.5">
                {[0, 0.5, 1].map(ratio => (
                  <div
                    key={ratio}
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: `hsl(210, 50%, ${85 - ratio * 40}%)` }}
                  />
                ))}
              </div>
              <span className="text-gray-500">
                {colorMode === 'characters' && 'Fewer → More characters'}
                {colorMode === 'chars-per-guest' && 'Fewer → More chars/guest'}
                {colorMode === 'guests' && 'Fewer → More guests'}
              </span>
            </div>

            {/* Recency legend */}
            <div className="flex items-center gap-1">
              <span className="text-gray-400">Recency:</span>
              <div className="flex gap-0.5">
                {[0, 0.5, 1].map(r => (
                  <div
                    key={r}
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getRecencyColor(r) }}
                  />
                ))}
              </div>
              <span className="text-gray-400">old → new</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ==========================================================================
// MOUNT THE APP
// ==========================================================================
// This is where React takes over the #root element and renders our app.
// createRoot is the React 18 way to mount an app (replaces ReactDOM.render).
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
