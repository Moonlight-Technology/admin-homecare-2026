import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/access/access.decorators';
import { DocumentsService } from './documents.service';

/**
 * Upload and download through signed, short-lived links (no session): the browser PUTs the file straight here, and
 * previews open `content` in a new tab. The token in the link is the authorisation (spec §10, AC-SEC-02).
 */
@ApiTags('Documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Put(':id/upload')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string | undefined, @Req() request: Request) {
    await this.documents.receiveUpload(id, token, request.header('content-type'), request);
  }

  @Get(':id/content')
  @Public()
  @SkipThrottle()
  async content(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string | undefined, @Res({ passthrough: true }) response: Response) {
    const file = await this.documents.openContent(id, token);
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.sizeBytes),
      // ASCII fallback plus the exact UTF-8 name (RFC 5987), so non-Latin file names cannot break the header.
      'Content-Disposition': `inline; filename="${file.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    return new StreamableFile(file.stream);
  }
}
