import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { AuthRequest } from '../middleware/auth.middleware';

const client = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_CALLBACK_URL
);

export class AuthController {
  static async googleAuth(req: Request, res: Response) {
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
      prompt: 'consent'
    });
    res.redirect(url);
  }

  static async googleCallback(req: Request, res: Response) {
    const { code } = req.query;
    
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    try {
      const { tokens } = await client.getToken(code);
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: env.GOOGLE_CLIENT_ID,
      });
      
      const payload = ticket.getPayload();
      
      if (!payload || !payload.email) {
        return res.status(400).json({ success: false, message: 'Failed to verify Google account' });
      }

      const { sub: googleId, email, name, picture: avatarUrl } = payload;

      let user = await prisma.user.findUnique({ where: { google_id: googleId } });

      if (!user) {
        user = await prisma.user.create({
          data: {
            google_id: googleId,
            email,
            name: name || 'Unknown',
            avatar_url: avatarUrl,
          }
        });
      }

      const jwtToken = jwt.sign({ userId: user.id }, env.JWT_SECRET, { expiresIn: '7d' });

      // Redirect back to the frontend with the token
      res.redirect(`${env.FRONTEND_URL}/login?token=${jwtToken}`);

    } catch (error) {
      console.error('Google OAuth error:', error);
      res.status(500).json({ success: false, message: 'OAuth processing failed' });
    }
  }

  static async getMe(req: AuthRequest, res: Response) {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, name: true, email: true, avatar_url: true }
      });

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      res.json({ success: true, user });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  static async logout(req: Request, res: Response) {
    // With JWT, logout is usually handled client-side by dropping the token
    res.json({ success: true, message: 'Logged out' });
  }
}
