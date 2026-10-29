// Adds the 4 sample jobs the first time (only if the jobs table is empty).
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  if ((await prisma.job.count()) > 0) return console.log('Jobs already exist. Skipping seed.');
  const now = Date.now();
  const j = (n, company, title, location, type, salary, description, requirements) => ({
    company, title, location, type, salary, description, requirements,
    employerId: null, createdAt: new Date(now - (10 - n) * 1000)
  });
  await prisma.job.createMany({
    data: [
      j(1, 'Northstar Digital', 'Junior Frontend Developer', 'Metro Manila', 'Full-time', '₱25,000 – ₱35,000 / month', 'Help build accessible, responsive web experiences with our product team.', 'HTML, CSS, JavaScript; React familiarity is a plus.'),
      j(2, 'BrightPath Solutions', 'IT Support Associate', 'Metro Manila', 'Full-time', '', 'Provide technical support, troubleshoot user issues, and maintain workstations.', 'Basic networking, Windows support, strong communication.'),
      j(3, 'Orbit Creative', 'UI/UX Design Intern', 'Cebu', 'Internship', '', 'Support design research, wireframes, and prototypes for web products.', 'Figma or similar design tool; portfolio or school projects welcome.'),
      j(4, 'Harbor Retail Group', 'Customer Service Representative', 'Remote', 'Part-time', '₱18,000 / month', 'Assist customers by chat and email and resolve order concerns.', 'Good English, typing speed, willingness to learn.')
    ]
  });
  console.log('Seeded 4 sample jobs.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
