import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Upload a verification document', description: 'Use the upload URL returned by upload-init. Send raw file bytes with the declared Content-Type, not multipart/form-data. PDF/JPEG/PNG only; maximum 10 MiB. The signed token authorizes this request.' })
  @ApiQuery({ name: 'token', required: true, type: String, description: 'Short-lived token from the upload-init URL.' })
  @ApiConsumes('application/pdf', 'image/jpeg', 'image/png')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string | undefined, @Req() request: Request) {
    await this.documents.receiveUpload(id, token, request.header('content-type'), request);
  }

  @Get(':id/content')
  @ApiOperation({ summary: 'Download a verification document', description: 'Use the signed URL issued by an authorized document URL endpoint. Returns raw file bytes with private, no-store caching.' })
  @ApiQuery({ name: 'token', required: true, type: String, description: 'Short-lived token from the signed download URL.' })
  @ApiResponse({ status: 200, description: 'Document file bytes.', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } })
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
