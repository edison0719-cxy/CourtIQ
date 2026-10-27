/* Venue activity summaries. Counts are documentation measures, never quality scores. */
function summarizeVenues(records) {
  const training = records.filter(record => !record.is_example);
  const groups = new Map();
  for (const record of training) {
    const name = String(record.venue || '').trim();
    if (!groups.has(name)) {
      groups.set(name, { name, trainingCount: 0, completedCount: 0, reviewedCount: 0, latestAt: '', latestId: null });
    }
    const group = groups.get(name);
    group.trainingCount += 1;
    group.completedCount += Number(record.status === 'completed');
    group.reviewedCount += Number(Boolean(String(record.notes || '').trim()));
    const createdAt = String(record.created_at || '');
    if (!group.latestId || createdAt > group.latestAt) {
      group.latestAt = createdAt;
      group.latestId = record.id;
    }
  }
  const venues = [...groups.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  return {
    trainingCount: training.length,
    venueCount: venues.filter(venue => venue.name).length,
    completedCount: venues.reduce((total, venue) => total + venue.completedCount, 0),
    reviewedCount: venues.reduce((total, venue) => total + venue.reviewedCount, 0),
    unassignedCount: groups.get('')?.trainingCount || 0,
    excludedExamples: records.length - training.length,
    venues,
  };
}

function filterSessions(records, { query = '', status = 'all' } = {}) {
  const term = query.trim().toLocaleLowerCase();
  return records.filter(record => {
    const matchesStatus = status === 'all' || (status === 'processing'
      ? ['queued', 'running'].includes(record.status) : record.status === status);
    return matchesStatus && (!term || ['title', 'venue', 'near_name', 'far_name', 'original_filename']
      .some(key => String(record[key] || '').toLocaleLowerCase().includes(term)));
  });
}

if (typeof module !== 'undefined') module.exports = { summarizeVenues, filterSessions };
if (typeof window !== 'undefined') window.CourtIQPlanning = { summarizeVenues, filterSessions };
