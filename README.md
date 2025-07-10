# MyForm Bot

MyForm Bot is a French Discord bot designed to help you create and manage interactive forms directly within your Discord server. With an intuitive interface and powerful features, MyForm Bot simplifies the process of collecting and managing responses from your community.

## Features

- **Simple Forms**: Create interactive forms directly in Discord without any technical knowledge.
- **Real-Time Responses**: Receive responses instantly in a dedicated channel.
- **Review System**: Accept or reject responses with an integrated validation system.
- **Unique Responses**: Limit users to one response per form to avoid duplicates.
- **Role Assignment**: Automatically assign roles to users based on their response status.
- **Web Interface**: Manage your forms from a responsive web interface, accessible on both desktop and mobile.
- **Optimized Performance**: Lightweight and responsive bot, designed to work efficiently even on highly active servers.
- **Notifications**: Private notifications to users when their response is processed.
- **Built-In Security**: Role-based permission system to ensure only authorized admins can manage forms.

## How It Works

1. **Connect**: Log in with your Discord account and select a server where you have the required permissions.
2. **Create Your Form**: Define your questions, customize the appearance, and choose where the responses will be sent.
3. **Share and Manage**: The form appears on your Discord server. Manage and review responses with ease.

## Installation

1. Invite the bot to your server using the following link:
   [Invite MyForm Bot](https://discord.com/oauth2/authorize?client_id=1367532884684050583&permissions=8&integration_type=0&scope=bot)

2. Log in to the web interface to manage your forms:
   [MyForm Dashboard](https://myform.trisout.fr)

## Requirements

- A Discord server where you have administrative permissions.
- A web browser to access the management dashboard.

## Self-Hosting

If you prefer to self-host MyForm Bot, follow these steps:

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-repo/forms-bot.git
   cd forms-bot
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Configuration**:
   Edit the `config.json` file in the root directory and configure the following fields:
   ```json
   {
     "token": "",
     "clientId": "",
     "clientSecret": "",
     "permission": {
       "base": ":x: You don't have the `{perm}` permission to do that !",
       "NOTE": "Add {perm} to say the discord permission name !"
     },
     "webserver": {
       "port": 3000,
       "baseUrl": "http://localhost:3000"
     },
     "secretKey": "change_this_to_a_secure_random_string",
     "adminKey": "admin_secure_key_change_this_in_production",
     "webhookUrl": "",  
     "paypal": {
       "email": "sb-maosj20404225@business.example.com",
       "sandbox": true,
       "price": "3.99",
       "currency": "EUR"
     },
     "topgg": {
       "authorization": "your_shared_secret_here",
       "botId": ""
     },
     "openai": {
       "apiKey": ""
     },
     "clarty": {
       "enabled": true,
       "apiKey": "",
       "apiUrl": "https://openbl.clarty.org/api/v1"
     },
     "staff": [
       "637213291558469663"
     ]
   }
   ```

4. **Start the Bot**:
   ```bash
   npm start
   ```

5. **Access the Web Interface**:
   Open your browser and navigate to `http://localhost:3000` to manage your forms.

## Support

If you encounter any issues or have questions, feel free to contact the developer.

## License

This project is licensed under the GNU GENERAL PUBLIC LICENSE V3.0 License. See the LICENSE file for details.