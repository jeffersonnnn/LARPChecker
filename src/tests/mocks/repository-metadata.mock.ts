export const mockRepositoryMetadata = {
  name: 'test-repo',
  owner: 'testuser',
  description: 'A test repository',
  stars: 100,
  forks: 50,
  issues: 10,
  contributors: 5,
  languages: { TypeScript: 1000 },
  url: 'https://github.com/testuser/test-repo',
  size: 1000,
  createdAt: new Date('2023-01-01').toISOString(),
  updatedAt: new Date('2023-12-31').toISOString(),
  topics: ['typescript', 'testing'],
  isPrivate: false,
  hasIssues: true,
  hasProjects: true,
  hasWiki: true,
  archived: false,
  disabled: false,
  license: {
    key: 'mit',
    name: 'MIT License',
    url: 'https://api.github.com/licenses/mit'
  }
}; 