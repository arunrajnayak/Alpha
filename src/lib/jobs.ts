import { prisma } from '@/lib/db';
import { Job } from '@prisma/client';

export async function createJob(type: string, initialMessage: string = 'Queued'): Promise<Job> {
  return await prisma.job.create({
    data: {
      type,
      status: 'QUEUED',
      progress: 0,
      message: initialMessage,
    },
  });
}

export async function updateJob(
  id: string,
  progress: number,
  message?: string,
  status: string = 'RUNNING'
): Promise<Job> {
  return await prisma.job.update({
    where: { id },
    data: {
      progress,
      message,
      status,
    },
  });
}

export async function completeJob(id: string, result?: unknown): Promise<Job> {
  return await prisma.job.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      progress: 100,
      message: 'Completed',
      result: result ? JSON.stringify(result) : undefined,
    },
  });
}

export async function failJob(id: string, error: unknown): Promise<Job> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return await prisma.job.update({
        where: { id },
        data: {
            status: 'FAILED',
            message: 'Failed',
            error: errorMsg
        }
    });
}

export async function getJob(id: string): Promise<Job | null> {
    return await prisma.job.findUnique({
        where: { id }
    });
}
