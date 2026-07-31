export function buildSkillContent(name: string, description: string) {
  const routingDescription = `Use when asked for ${name.slice(0, 35)}.`
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(routingDescription)}`,
    'version: 1.0.0',
    'author: Hermes Business',
    '---',
    '',
    `# ${name}`,
    '',
    description,
    '',
    'Follow this process carefully and improve it when the user provides corrections.'
  ].join('\n')
}
