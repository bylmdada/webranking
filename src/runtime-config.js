const DEFAULT_PROFILE = 'default';

const RUNTIME_PROFILES = {
  default: {
    visitReadingMinMs: 30000,
    visitReadingMaxMs: 90000,
    searchReadingMinMs: 60000,
    searchReadingMaxMs: 120000,
    searchGapMinMs: 120000,
    searchGapMaxMs: 300000,
    siteGapMinMs: 5000,
    siteGapMaxMs: 15000,
  },
  ci: {
    visitReadingMinMs: 8000,
    visitReadingMaxMs: 15000,
    searchReadingMinMs: 12000,
    searchReadingMaxMs: 20000,
    searchGapMinMs: 15000,
    searchGapMaxMs: 25000,
    siteGapMinMs: 2000,
    siteGapMaxMs: 5000,
  },
};

function getRuntimeProfile() {
  const requestedProfile = process.env.SIMULATION_PROFILE?.trim() || DEFAULT_PROFILE;
  const profileName = Object.hasOwn(RUNTIME_PROFILES, requestedProfile) ? requestedProfile : DEFAULT_PROFILE;

  return {
    name: profileName,
    ...RUNTIME_PROFILES[profileName],
  };
}

module.exports = {
  getRuntimeProfile,
  RUNTIME_PROFILES,
};