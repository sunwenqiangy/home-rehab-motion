import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { randomBytes, scryptSync } from 'crypto';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

type AdminRole = 'admin' | 'nurse';

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function parseRole(value: unknown): AdminRole {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin' || role === 'nurse') {
    return role;
  }
  throw new BadRequestException('角色仅支持 admin 或 nurse');
}

function parseStatus(value: unknown): 0 | 1 {
  if (value === 0 || value === '0') {
    return 0;
  }
  if (value === 1 || value === '1') {
    return 1;
  }
  throw new BadRequestException('状态仅支持 0(禁用) 或 1(启用)');
}

@Controller('admin/accounts')
export class AdminAccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async listAccounts(@Req() req: Request) {
    this.authService.requireUser(req, ['admin']);

    const accounts = await this.prisma.adminAccount.findMany({
      orderBy: { created_at: 'desc' },
      take: 200,
    });

    return accounts.map((item) => ({
      accountId: Number(item.account_id),
      username: item.username,
      displayName: item.display_name || undefined,
      role: item.role,
      status: item.status,
      createdAt: item.created_at.toISOString(),
      updatedAt: item.updated_at.toISOString(),
    }));
  }

  @Post()
  async createAccount(
    @Req() req: Request,
    @Body()
    payload: {
      username?: string;
      password?: string;
      role?: string;
      displayName?: string;
    },
  ) {
    this.authService.requireUser(req, ['admin']);

    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username) {
      throw new BadRequestException('用户名不能为空');
    }
    if (password.length < 12) {
      throw new BadRequestException('密码长度至少 12 位');
    }

    const role = parseRole(payload.role || 'nurse');

    const existing = await this.prisma.adminAccount.findUnique({
      where: { username },
    });
    if (existing) {
      throw new BadRequestException('用户名已存在');
    }

    const created = await this.prisma.adminAccount.create({
      data: {
        username,
        password_hash: hashPassword(password),
        display_name: payload.displayName ? String(payload.displayName).trim() : null,
        role,
        status: 1,
      },
    });

    return {
      accountId: Number(created.account_id),
      username: created.username,
      displayName: created.display_name || undefined,
      role: created.role,
      status: created.status,
      createdAt: created.created_at.toISOString(),
      updatedAt: created.updated_at.toISOString(),
    };
  }

  @Patch(':accountId')
  async updateAccount(
    @Req() req: Request,
    @Param('accountId') accountId: string,
    @Body()
    payload: {
      role?: string;
      status?: 0 | 1 | '0' | '1';
      displayName?: string;
    },
  ) {
    const operator = this.authService.requireUser(req, ['admin']);

    const id = Number(accountId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('accountId 非法');
    }

    const existing = await this.prisma.adminAccount.findUnique({
      where: { account_id: BigInt(id) },
    });
    if (!existing) {
      throw new BadRequestException('账号不存在');
    }
    if (operator.accountId && Number(operator.accountId) === id) {
      if (payload.role !== undefined && parseRole(payload.role) !== 'admin') {
        throw new BadRequestException('不允许将当前账号降权');
      }
      if (payload.status !== undefined && parseStatus(payload.status) !== 1) {
        throw new BadRequestException('不允许禁用当前登录账号');
      }
    }

    const data: {
      role?: AdminRole;
      status?: 0 | 1;
      display_name?: string | null;
    } = {};

    if (payload.role !== undefined) {
      data.role = parseRole(payload.role);
    }
    if (payload.status !== undefined) {
      data.status = parseStatus(payload.status);
    }
    if (payload.displayName !== undefined) {
      const normalized = String(payload.displayName || '').trim();
      data.display_name = normalized || null;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('没有可更新的字段');
    }

    const updated = await this.prisma.adminAccount.update({
      where: { account_id: BigInt(id) },
      data,
    });

    return {
      accountId: Number(updated.account_id),
      username: updated.username,
      displayName: updated.display_name || undefined,
      role: updated.role,
      status: updated.status,
      createdAt: updated.created_at.toISOString(),
      updatedAt: updated.updated_at.toISOString(),
    };
  }

  @Patch(':accountId/password')
  async resetPassword(
    @Req() req: Request,
    @Param('accountId') accountId: string,
    @Body() payload: { password?: string },
  ) {
    this.authService.requireUser(req, ['admin']);

    const id = Number(accountId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('accountId 非法');
    }

    const password = String(payload.password || '');
    if (password.length < 12) {
      throw new BadRequestException('密码长度至少 12 位');
    }

    await this.prisma.adminAccount.update({
      where: { account_id: BigInt(id) },
      data: {
        password_hash: hashPassword(password),
      },
    });

    return {
      accountId: id,
      reset: true,
    };
  }

  @Delete(':accountId')
  async removeAccount(@Req() req: Request, @Param('accountId') accountId: string) {
    const operator = this.authService.requireUser(req, ['admin']);

    const id = Number(accountId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('accountId 非法');
    }

    if (operator.accountId && Number(operator.accountId) === id) {
      throw new BadRequestException('不允许删除当前登录账号');
    }

    const existing = await this.prisma.adminAccount.findUnique({
      where: { account_id: BigInt(id) },
    });
    if (!existing) {
      throw new BadRequestException('账号不存在');
    }

    await this.prisma.adminAccount.delete({
      where: { account_id: BigInt(id) },
    });

    return {
      accountId: id,
      removed: true,
    };
  }
}
