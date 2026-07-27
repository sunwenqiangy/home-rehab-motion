import 'reflect-metadata';
import { randomBytes, scryptSync } from 'crypto';
import { PrismaClient } from '@prisma/client';

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

async function bootstrap() {
  const username = String(process.env.BOOTSTRAP_ADMIN_USERNAME || '').trim();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const displayName = String(process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || '初始管理员').trim();

  if (!username || password.length < 12) {
    throw new Error('请设置 BOOTSTRAP_ADMIN_USERNAME 和至少 12 位的 BOOTSTRAP_ADMIN_PASSWORD');
  }

  const prisma = new PrismaClient();
  try {
    const count = await prisma.adminAccount.count();
    if (count > 0) {
      throw new Error('管理员账号已存在；初始引导命令只能在无管理员账号时执行');
    }
    await prisma.adminAccount.create({
      data: {
        username,
        password_hash: hashPassword(password),
        display_name: displayName || null,
        role: 'admin',
        status: 1,
      },
    });
    console.log(`初始管理员 ${username} 已创建`);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
